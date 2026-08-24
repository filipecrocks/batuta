/** Authenticated daily aggregate ingestion (v2 English; v1 compatibility). */
import { hasDatabase, sql } from "../../../../lib/db";
import {
  type VerifiedRequest,
  claimIngestRequest,
  completeIngestRequest,
  failIngestRequest,
} from "../../../../lib/ingest-db";
import {
  findForbiddenKey,
  readLimitedUtf8Body,
  validateDailySummary,
  verifySignedRequest,
} from "../../../../lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 256 * 1024;

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function GET() {
  return response(
    {
      ok: false,
      error: "POST a signed batuta.daily_summary.v2 document",
      schema: "https://batuta.space/schema/daily-summary.v2.schema.json",
    },
    405,
    { allow: "POST" },
  );
}

export async function POST(request: Request) {
  const started = performance.now();
  if (!hasDatabase()) return response({ ok: false, error: "ingestion unavailable" }, 503);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return response({ ok: false, error: "content-type must be application/json" }, 415);
  }
  const bodyResult = await readLimitedUtf8Body(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) return response({ ok: false, error: bodyResult.error }, bodyResult.status);
  const rawBody = bodyResult.body;
  const signed = await verifySignedRequest(
    rawBody,
    request.headers,
    process.env.BATUTA_INGEST_PUBLIC_KEYS,
  );
  if (!signed.ok) return response({ ok: false, error: signed.error }, 401);
  const verifiedRequest = signed as VerifiedRequest;

  let untrusted: unknown;
  try {
    untrusted = JSON.parse(rawBody);
  } catch {
    return response({ ok: false, error: "body is not valid JSON" }, 400);
  }
  const forbidden = findForbiddenKey(untrusted);
  if (forbidden) return response({ ok: false, error: `privacy-forbidden key at ${forbidden}` }, 400);
  const validation = validateDailySummary(untrusted);
  if (!validation.normalized) {
    return response(
      { ok: false, error: "body does not match a supported daily summary", problems: validation.errors.slice(0, 25) },
      422,
    );
  }
  const summary = validation.normalized;

  let claimed = false;
  try {
    const claim = await claimIngestRequest(verifiedRequest, "daily_summary");
    if (claim.claim_status === "replay") {
      return response(claim.cached_response, claim.cached_http_status, { "x-batuta-idempotent-replay": "true" });
    }
    if (claim.claim_status === "rate_limited") {
      return response({ ok: false, error: "rate limit exceeded" }, 429, { "retry-after": "60" });
    }
    if (claim.claim_status === "conflict") {
      return response({ ok: false, error: "idempotency key was reused with a different request" }, 409);
    }
    if (claim.claim_status === "in_progress") {
      return response({ ok: false, error: "an identical request is still in progress" }, 409, { "retry-after": "5" });
    }
    claimed = true;

    await sql`
      insert into batuta.installations (id, batuta_version, mode)
      values (${summary.installationId}, ${summary.batutaVersion}, ${summary.mode})
      on conflict (id) do update set
        last_seen = now(),
        batuta_version = excluded.batuta_version,
        mode = excluded.mode
    `;
    await sql`
      insert into batuta.daily_summaries (installation_id, day, payload, hash)
      values (${summary.installationId}, ${summary.date}::date, ${rawBody}::jsonb, ${verifiedRequest.requestHash})
      on conflict (installation_id, day) do update set
        payload = excluded.payload,
        hash = excluded.hash,
        received_at = now()
    `;
    const rollup = await sql<{ rows_recalculated: number }>`
      select batuta.recalculate_day_metrics(${summary.date}::date) as rows_recalculated
    `;
    const body = {
      ok: true,
      observed: true,
      date: summary.date,
      skills: summary.skills.length,
      rows_recalculated: rollup[0]?.rows_recalculated ?? 0,
      request_hash: verifiedRequest.requestHash,
      measurement_disclaimer:
        "Batuta stored an aggregate observation. This response is not proof that any task was delivered.",
    };
    await completeIngestRequest(verifiedRequest, body, 202);
    console.info(
      JSON.stringify({
        event: "daily_summary_ingest_observed",
        requestId: verifiedRequest.idempotencyKey,
        signerKeyId: verifiedRequest.keyId,
        date: summary.date,
        skills: summary.skills.length,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      }),
    );
    return response(body, 202, { "x-request-id": verifiedRequest.idempotencyKey });
  } catch (error) {
    if (claimed) {
      try {
        await failIngestRequest(verifiedRequest);
      } catch {
        // The stale-claim recovery path handles this safely.
      }
    }
    console.error(
      JSON.stringify({
        event: "daily_summary_ingest_failed",
        requestId: verifiedRequest.idempotencyKey,
        signerKeyId: verifiedRequest.keyId,
        errorType: error instanceof Error ? error.name : "unknown",
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      }),
    );
    return response({ ok: false, error: "failed to store summary; retry with the same idempotency key" }, 500);
  }
}

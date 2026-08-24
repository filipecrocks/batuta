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
const INGEST_KIND = "daily_summary" as const;

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
    process.env.BATUTA_DAILY_PUBLIC_KEYS,
  );
  if (!signed.ok) return response({ ok: false, error: signed.error }, 401);
  const verifiedRequest = signed as VerifiedRequest;

  let claimed = false;
  try {
    // Claim immediately after authentication so invalid signed traffic is also
    // rate limited. A rejected payload releases only its idempotency claim; the
    // per-minute rate-window count remains consumed.
    const claim = await claimIngestRequest(verifiedRequest, INGEST_KIND);
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

    let untrusted: unknown;
    try {
      untrusted = JSON.parse(rawBody);
    } catch {
      await failIngestRequest(verifiedRequest, INGEST_KIND);
      claimed = false;
      return response({ ok: false, error: "body is not valid JSON" }, 400);
    }
    const forbidden = findForbiddenKey(untrusted);
    if (forbidden) {
      await failIngestRequest(verifiedRequest, INGEST_KIND);
      claimed = false;
      return response({ ok: false, error: `privacy-forbidden key at ${forbidden}` }, 400);
    }
    const validation = validateDailySummary(untrusted);
    if (!validation.normalized) {
      await failIngestRequest(verifiedRequest, INGEST_KIND);
      claimed = false;
      return response(
        { ok: false, error: "body does not match a supported daily summary", problems: validation.errors.slice(0, 25) },
        422,
      );
    }
    const summary = validation.normalized;

    const stored = await sql<{ store_status: "accepted" | "not_enrolled"; rows_recalculated: number }>`
      select store_status, rows_recalculated
      from batuta.store_daily_summary(
        ${summary.installationId},
        ${verifiedRequest.keyId},
        ${summary.date}::date,
        ${summary.batutaVersion},
        ${summary.mode},
        ${rawBody}::jsonb,
        ${verifiedRequest.requestHash}
      )
    `;
    if (stored[0]?.store_status === "not_enrolled") {
      await failIngestRequest(verifiedRequest, INGEST_KIND);
      claimed = false;
      return response({ ok: false, error: "installation is not enrolled for this daily signer" }, 403);
    }
    if (stored[0]?.store_status !== "accepted") {
      throw new Error("store_daily_summary returned no decision");
    }
    const body = {
      ok: true,
      observed: true,
      date: summary.date,
      skills: summary.skills.length,
      rows_recalculated: stored[0].rows_recalculated,
      request_hash: verifiedRequest.requestHash,
      measurement_disclaimer:
        "Batuta stored an aggregate observation. This response is not proof that any task was delivered.",
    };
    await completeIngestRequest(verifiedRequest, INGEST_KIND, body, 202);
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
        await failIngestRequest(verifiedRequest, INGEST_KIND);
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

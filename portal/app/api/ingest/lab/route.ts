/** Authenticated LAB -> Batuta observational event ingestion. */
import { hasDatabase, sql } from "../../../../lib/db";
import {
  type VerifiedRequest,
  claimIngestRequest,
  completeIngestRequest,
  failIngestRequest,
} from "../../../../lib/ingest-db";
import {
  type LabEvent,
  findForbiddenKey,
  readLimitedUtf8Body,
  validateLabEvent,
  verifyReceipt,
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

function claimResponse(claim: Awaited<ReturnType<typeof claimIngestRequest>>): Response | null {
  if (claim.claim_status === "accepted") return null;
  if (claim.claim_status === "replay") {
    return response(claim.cached_response, claim.cached_http_status, {
      "x-batuta-idempotent-replay": "true",
    });
  }
  if (claim.claim_status === "rate_limited") {
    return response({ ok: false, error: "rate limit exceeded" }, 429, { "retry-after": "60" });
  }
  if (claim.claim_status === "conflict") {
    return response({ ok: false, error: "idempotency key was reused with a different request" }, 409);
  }
  return response({ ok: false, error: "an identical request is still in progress" }, 409, {
    "retry-after": "5",
  });
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
  const validationErrors = validateLabEvent(untrusted);
  if (validationErrors.length) {
    return response(
      { ok: false, error: "body does not match batuta.lab_event.v1", problems: validationErrors.slice(0, 25) },
      422,
    );
  }
  const event = untrusted as LabEvent;
  if (event.receipt.key_id !== verifiedRequest.keyId) {
    return response({ ok: false, error: "receipt key_id must match authenticated request key" }, 401);
  }
  if (!(await verifyReceipt(event, process.env.BATUTA_INGEST_PUBLIC_KEYS))) {
    return response({ ok: false, error: "runner receipt signature verification failed" }, 401);
  }
  let claimed = false;
  try {
    const claim = await claimIngestRequest(verifiedRequest, "lab_event");
    const early = claimResponse(claim);
    if (early) return early;
    claimed = true;

    const judge = event.outcome.judge;
    const inserted = await sql<{ event_id: string }>`
      insert into batuta.lab_events (
        event_id, run_id, project, event_order, tool, model, skill, cost_usd,
        outcome_status, outcome_authority, judge_model, judge_version,
        judge_criteria_hash, runner_receipt, signer_key_id, signed_request_at,
        request_signature, request_hash, payload
      ) values (
        ${event.event_id}::uuid,
        ${event.run_id},
        ${event.project},
        ${event.order},
        ${event.tool},
        ${event.model},
        ${event.skill},
        ${event.cost.amount},
        ${event.outcome.status},
        ${event.outcome.authority},
        ${judge?.model ?? null},
        ${judge?.version ?? null},
        ${judge?.criteria_hash ?? null},
        ${JSON.stringify(event.receipt)}::jsonb,
        ${verifiedRequest.keyId},
        to_timestamp(${verifiedRequest.timestamp}),
        ${verifiedRequest.signature},
        ${verifiedRequest.requestHash},
        ${rawBody}::jsonb
      )
      on conflict do nothing
      returning event_id::text
    `;

    if (!inserted[0]) {
      const existing = await sql<{ request_hash: string }>`
        select request_hash
        from batuta.lab_events
        where event_id = ${event.event_id}::uuid
           or (run_id = ${event.run_id} and event_order = ${event.order})
        limit 1
      `;
      if (existing[0]?.request_hash !== verifiedRequest.requestHash) {
        await failIngestRequest(verifiedRequest);
        return response({ ok: false, error: "event identity conflicts with a different payload" }, 409);
      }
    }

    const body = {
      ok: true,
      observed: true,
      event_id: event.event_id,
      request_hash: verifiedRequest.requestHash,
      runner_receipt_verified: true,
      measurement_disclaimer:
        "Batuta recorded observational telemetry. This response is not proof of delivery; the evidence receipt was issued by the trusted runner and the verdict by an independent judge.",
    };
    await completeIngestRequest(verifiedRequest, body, 202);
    console.info(
      JSON.stringify({
        event: "lab_ingest_observed",
        requestId: verifiedRequest.idempotencyKey,
        signerKeyId: verifiedRequest.keyId,
        eventId: event.event_id,
        outcomeStatus: event.outcome.status,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      }),
    );
    return response(body, 202, { "x-request-id": verifiedRequest.idempotencyKey });
  } catch (error) {
    if (claimed) {
      try {
        await failIngestRequest(verifiedRequest);
      } catch {
        // Preserve the original failure; a stale claim is safely reclaimable.
      }
    }
    console.error(
      JSON.stringify({
        event: "lab_ingest_failed",
        requestId: verifiedRequest.idempotencyKey,
        signerKeyId: verifiedRequest.keyId,
        errorType: error instanceof Error ? error.name : "unknown",
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      }),
    );
    return response({ ok: false, error: "failed to record event; retry with the same idempotency key" }, 500);
  }
}

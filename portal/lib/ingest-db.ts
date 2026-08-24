import { createHash } from "node:crypto";
import { sql } from "./db";

export type VerifiedRequest = {
  keyId: string;
  idempotencyKey: string;
  requestHash: string;
  signature: string;
  timestamp: number;
};

type ClaimRow = {
  claim_status: "accepted" | "replay" | "conflict" | "in_progress" | "rate_limited";
  cached_response: unknown | null;
  cached_http_status: number;
};

export type IngestKind = "daily_summary" | "lab_event";

function scopedSigner(request: VerifiedRequest, kind: IngestKind): string {
  // Keep endpoint idempotency/rate scopes distinct without exceeding the
  // database's 128-character identifier bound for long but valid key IDs.
  return `${kind}:${createHash("sha256").update(request.keyId, "utf8").digest("hex")}`;
}

export async function claimIngestRequest(
  request: VerifiedRequest,
  kind: IngestKind,
): Promise<ClaimRow> {
  const rows = await sql<ClaimRow>`
    select claim_status, cached_response, cached_http_status
    from batuta.claim_ingest_request(
      ${scopedSigner(request, kind)},
      ${request.idempotencyKey},
      ${kind},
      ${request.requestHash},
      60
    )
  `;
  if (!rows[0]) throw new Error("claim_ingest_request returned no row");
  return rows[0];
}

export async function completeIngestRequest(
  request: VerifiedRequest,
  kind: IngestKind,
  response: unknown,
  status: number,
): Promise<void> {
  await sql`
    select batuta.complete_ingest_request(
      ${scopedSigner(request, kind)},
      ${request.idempotencyKey},
      ${request.requestHash},
      ${JSON.stringify(response)}::jsonb,
      ${status}
    )
  `;
}

export async function failIngestRequest(request: VerifiedRequest, kind: IngestKind): Promise<void> {
  await sql`
    select batuta.fail_ingest_request(
      ${scopedSigner(request, kind)},
      ${request.idempotencyKey},
      ${request.requestHash}
    )
  `;
}

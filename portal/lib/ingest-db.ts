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

export async function claimIngestRequest(
  request: VerifiedRequest,
  kind: "daily_summary" | "lab_event",
): Promise<ClaimRow> {
  const rows = await sql<ClaimRow>`
    select claim_status, cached_response, cached_http_status
    from batuta.claim_ingest_request(
      ${request.keyId},
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
  response: unknown,
  status: number,
): Promise<void> {
  await sql`
    select batuta.complete_ingest_request(
      ${request.keyId},
      ${request.idempotencyKey},
      ${request.requestHash},
      ${JSON.stringify(response)}::jsonb,
      ${status}
    )
  `;
}

export async function failIngestRequest(request: VerifiedRequest): Promise<void> {
  await sql`
    select batuta.fail_ingest_request(
      ${request.keyId},
      ${request.idempotencyKey},
      ${request.requestHash}
    )
  `;
}

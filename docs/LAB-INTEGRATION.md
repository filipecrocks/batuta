# LAB → Batuta observational event contract

Every completed LAB processing unit produces one `batuta.lab_event.v1` document.
The reference implementation is `adapters/lab/batuta-adapter.mjs`; the normative
shape is `schema/lab-event.v1.schema.json`.

Each event carries a UUIDv7 `event_id`, stable `run_id`, project, monotonically
assigned `order`, tool, subject model, optional skill, USD cost, outcome, and a
trusted-runner receipt. It contains no prompt, prompt hash, response, transcript,
path, session identifier, credential, environment value, or secret. Batuta stores
and aggregates the event; that observation is never sole proof of delivery.

`passed` and `failed` require an independent, versioned judge whose model differs
from the subject model and whose frozen criteria are identified by SHA-256.
Runtime telemetry may only report `unknown`. Batuta does not mint evidence
receipts and does not turn an unsigned/self-attested outcome into success.

## Signing

Provision an Ed25519 key only on the trusted runner. Give Batuta only its SPKI
public key through `BATUTA_INGEST_PUBLIC_KEYS`, a JSON object from `key_id` to
base64 SPKI. Rotate by temporarily publishing old and new public keys under
different IDs, switch runners, then remove the old key after the replay window.
Never store a private key in the repository, Neon, Vercel, or Batuta.

The runner signs the receipt over these newline-delimited UTF-8 fields:

```text
batuta-receipt-v1
event_id
run_id
project
order
tool
model
skill-or--
cost.amount
cost.currency
outcome.status
outcome.authority
judge.model-or--
judge.version-or--
judge.criteria_hash-or--
receipt.issuer
receipt.key_id
receipt.algorithm
receipt.signed_at
receipt.evidence_hash
```

It also signs the exact HTTP body:

```text
batuta-request-v1
unix_timestamp_seconds
idempotency-key
sha256(exact_request_body)
```

POST to `/api/ingest/lab` with `Content-Type: application/json`,
`X-Batuta-Key-Id`, `X-Batuta-Timestamp`, `Idempotency-Key`, and
`X-Batuta-Signature`. Requests outside five minutes, invalid signatures,
privacy-forbidden keys, duplicate identities with different bodies, and excess
per-key request rates are rejected. Persist the prepared event before sending;
retries must reuse its exact body and idempotency key.

## Neon migration

Apply `sql/001_initial.sql`, `sql/002_chain.sql`, then
`sql/003_secure_ingest_lab.sql` in a transaction-capable migration session. The
third migration is safe to reapply: it adds idempotency/rate state, constrained
LAB events, privacy checks, and an aggregate view without destructive rewrites.
Grant the portal's least-privilege database role only the required table and
function privileges; the migration revokes public access.

Validate in staging before production. A successful API response says
`observed: true` and repeats the measurement disclaimer. It does not say the
underlying task was delivered. `script/test-sql.sh` applies every migration,
reapplies the safe migration, and exercises privacy, rate, replay, idempotency,
and conflict invariants against the pinned PostgreSQL 17 image used in CI.

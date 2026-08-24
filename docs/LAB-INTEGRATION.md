# LAB → Batuta observational event contract

Every completed LAB processing unit produces one `batuta.lab_event.v1` document.
The reference implementation is `adapters/lab/batuta-adapter.mjs`; the normative
shape is `schema/lab-event.v1.schema.json`.

Each event carries a UUIDv7 `event_id`, stable `run_id`, project, monotonically
assigned `order`, tool, subject model, optional skill, USD cost, outcome, and a
trusted-runner receipt. It contains no prompt, prompt hash, response, transcript,
path, session identifier, credential, environment value, or secret. Batuta stores
and aggregates the event; that observation is never sole proof of delivery.

`passed` and `failed` require a separately keyed independent, versioned judge
whose model differs from the subject model and whose frozen criteria are
identified by SHA-256. Runtime telemetry may only report `unknown`. Batuta does
not mint evidence receipts and does not turn an unsigned/self-attested outcome
into success. `routing.arm` is descriptive in v1: because assignment is not
preregistered and signed before execution, it cannot support a causal-lift claim.

## Signing

Provision distinct Ed25519 private keys for the trusted runner and independent
judge. Give Batuta only SPKI public keys: runner keys through
`BATUTA_RUNNER_PUBLIC_KEYS`, judge keys through `BATUTA_JUDGE_PUBLIC_KEYS`, and
pre-provisioned daily-import keys through `BATUTA_DAILY_PUBLIC_KEYS`. Each value
is a JSON object from `key_id` to base64 SPKI. Runner and judge key IDs and SPKI
bytes must differ. Rotate a role by temporarily publishing its old and new public
keys under different IDs, switching the signer, then removing the old key after
the replay window. Never store a private key in the repository, Neon, Vercel, or
Batuta.

The independent judge signs this newline-delimited UTF-8 message first:

```text
batuta-judge-v1
event_id
run_id
project
order
tool
model
skill-or--
routing.arm
routing.holdout_declared
cost.amount
cost.currency
outcome.status
outcome.authority
judge.model
judge.version
judge.criteria_hash
judge.attestation.issuer
judge.attestation.key_id
judge.attestation.algorithm
judge.attestation.signed_at
receipt.evidence_hash
```

Its detached base64 Ed25519 signature becomes
`outcome.judge.attestation.signature`. The runner then signs the complete event,
including that judge signature, over these newline-delimited UTF-8 fields:

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
routing.arm
routing.holdout_declared
cost.amount
cost.currency
outcome.status
outcome.authority
judge.model-or--
judge.version-or--
judge.criteria_hash-or--
judge.attestation.issuer-or--
judge.attestation.key_id-or--
judge.attestation.algorithm-or--
judge.attestation.signed_at-or--
judge.attestation.signature-or--
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

The trusted runner writes the resulting detached signature to
`receipt.signature`, serializes the event exactly once, and then signs the HTTP
request. POST to `/api/ingest/lab` with `Content-Type: application/json`,
`X-Batuta-Key-Id`, `X-Batuta-Timestamp`, `Idempotency-Key`, and
`X-Batuta-Signature`. Requests outside five minutes, invalid signatures,
privacy-forbidden keys, duplicate identities with different bodies, and excess
per-key request rates are rejected. Persist the prepared event before sending;
retries must reuse its exact body and idempotency key.

## Neon migration

Apply `sql/001_initial.sql`, `sql/002_chain.sql`, then
`sql/003_secure_ingest_lab.sql` in a transaction-capable migration session. The
third migration is safe to reapply: it adds idempotency/rate state, constrained
LAB events, privacy checks, aggregate views, and daily signer enrollment. It also
deliberately drops the obsolete arena `contact` column and its contents for data
minimization.
Grant the portal's least-privilege database role only the required table and
function privileges; the migration revokes public access.

Validate in staging before production. A successful API response says
`observed: true` and repeats the measurement disclaimer. It does not say the
underlying task was delivered. `script/test-sql.sh` applies every migration,
reapplies the safe migration, and exercises privacy, rate, replay, idempotency,
multi-runner identity, UTC bucketing, and conflict invariants against the pinned
PostgreSQL 17 image used in CI.

The daily endpoint is a controlled/staging import surface, not a public client
upload flow. Before accepting a summary, an operator must provision the exact
`(installation_id, signer_key_id)` pair in
`batuta.daily_installation_enrollments`. The CLI intentionally has no uploader or
private key. Production collection must remain disabled until public enrollment,
retention, and authenticated deletion workflows exist.

# Security and privacy model

Batuta assumes prompts, model output, local paths, session IDs, environment data,
and credentials are sensitive. The Rust hot path has no networking dependency.
Local state directories use owner-only permissions; sensitive files use
owner-read/write permissions, same-directory atomic replacement, fsync, and a
cross-process append lock.

The prompt boundary emits only allowlisted skill identifiers inside a fixed
`<batuta-route>` block. Skill descriptions and paths never cross that boundary.
Turn IDs use process, nanosecond, counter, and salted material so repeated prompts
do not collide. Routing and every installed lifecycle hook have a 300 ms deadline.

Upload endpoints require Ed25519 authentication of the exact body, a five-minute
timestamp window, a stable idempotency key, per-key rate limiting, recursive
privacy-key rejection, and a 256 KiB body limit. LAB evidence receipts are signed
by a trusted runner. Only a different, versioned judge can author a passed/failed
verdict. Structured logs include request/event IDs, signer IDs, outcome classes,
latency, and error classes, never payloads, signatures, prompts, receipts, or
credentials.

Daily summaries contain aggregates only. LAB storage retains stable run/order
correlation because it is required for processing observability; the public
metrics view deliberately removes run IDs, event IDs, signatures, and receipts.
Retention and deletion policy must be set by the Neon owner before production.

Report vulnerabilities privately to the repository owner. Do not include real
prompts, tokens, private keys, or production payloads in a report.

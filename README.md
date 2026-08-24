# Batuta

**The open measurement layer for Agent Skills.** Records privacy-minimized
observations about whether a skill works, at what cost, and on which model.
Curated benchmark releases can be published in a verifiable hash chain; the live
database is mutable operational storage, not an immutable source of truth.

It is not the 27th router on the market. Batuta is an **observability and
measurement layer** that works with any router. It is never the sole proof that
work was delivered, and it never judges its own telemetry.

→ [batuta.space](https://batuta.space) · [manifesto](MANIFESTO.md) · [the contract](SPEC.md)

---

## The problem

Dozens of skill routers exist today. **None of them publish data.** Each measures
its own goal with its own ruler, so none can prove it's better than the next one —
or that it's good for anything at all.

Meanwhile, the people who actually solve real problems in the world almost never
have the money for an expensive model, and have no way to know what works.

## Install

```sh
curl -fsSL https://batuta.space/install.sh | sh
batuta index
batuta install-hooks
```

After a few turns: `batuta report`.

**Nothing leaves your machine.** The report and daily-summary preview work 100%
offline. This release has no public uploader or signing-key enrollment. See
[what gets logged](https://batuta.space/privacidade) or run `batuta privacy`.

> **npm safety:** the unscoped `batuta` package on npm belongs to an unrelated
> publisher. Do not install it. The wrapper in this repository is intentionally
> private until a verified `@filipecrocks/batuta` release exists. Use the
> checksum-verified GitHub release installer above or build with Cargo.

## What's in here

```
crates/batuta/        the hot-path Rust binary — no dependencies, no network
  src/                BM25 router, inverted index, event log
  tests/              conformance and hardening tests — the contract for ports
portal/               static Next.js (Vercel) — ranking, recipes, arena, records
sql/                  replay-safe Neon migrations, LAB events, and the hash chain
schema/               JSON Schemas for private aggregates and signed LAB events
bateria/v1/           24 frozen tasks with acceptance criteria written beforehand
docs/PROTOCOLO.md     the Batuta Zero protocol and the judge's three laws
script/chain.mjs      append, verify, and stamp the hash chain
npm/                  ten-line wrapper that downloads the binary
hooks/                route, activation, and outcome lifecycle hooks
adapters/lab/          reference trusted-runner adapter (no prompts or secrets)
records/              the published chain — verifiable by anyone
```

## Reproducible performance claim

The committed claim is a budget, not a laptop-specific headline: the in-process
route benchmark must remain below 50 ms per route for the frozen 500+ skill
corpus, and hook execution has a real 300 ms wall-clock deadline. Run
`script/benchmark.sh` to print the commit, toolchain, OS, CPU, build profile, and
measured result. The benchmark does **not** claim to include process startup.
See [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## The rules that aren't negotiable

1. **Zero profit.** Nobody earns anything — not founders, not contributors.
2. **The prompt never leaves your machine.** Only a hash with a local salt, and the
   salt is never sent.
3. **The binary never touches the network.** The wrapper handles networking.
4. **Silence over noise.** A false positive costs more than a false negative.
5. **The judge is blind, independent from the subject model, and versioned.**
6. **A control group exists.** 5% of turns have the router deliberately silenced —
   declared, configurable, and can be turned off.
7. **The chain cannot be edited.** Every result carries the previous one's hash, and
   the top is stamped outside our control.

Details on each: [MANIFESTO.md](MANIFESTO.md) and [SPEC.md](SPEC.md).

## Contributing

What's worth more than code, in this order:

1. **Install it and inspect the local report** — do not send data until a public,
   authenticated enrollment and retention/deletion flow is released.
2. **Send a real task** to the [arena](https://batuta.space/arena).
3. **Run the Batuta Zero protocol** and publish the raw output.
4. **Find a flaw in the method** and open an issue. Credibility is the only product.

Porting the hot path to another language is also worth doing — and a port is
conformant when it passes `crates/batuta/tests/conformance.rs` with the exact same
numbers.

## Running the tests

```sh
cd crates/batuta
cargo test --locked --all-features -- --test-threads=1
cargo clippy --all-targets --all-features --locked -- -D warnings
cargo fmt --check
```

## License

MIT. See [LICENSE](LICENSE).

Every contributor's name goes into the portal and the dataset — next to the number
they helped produce, not into some generic acknowledgments list.

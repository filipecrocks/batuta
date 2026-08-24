# Batuta

**The open measurement layer for Agent Skills.** Measures whether a skill actually
works, at what cost, and on which model — and publishes everything, immutable,
zero-profit.

It's not the 27th router on the market. It's **the judge** — and it works with any
router.

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
curl -fsSL https://batuta.space/instalar.sh | sh    # or: npm install -g batuta
batuta index
batuta install-hooks
```

After a few turns: `batuta report`.

**Nothing leaves your machine.** The report works 100% offline; sending aggregated
data is explicit opt-in. See [what gets logged](https://batuta.space/privacidade) or
run `batuta privacidade`.

## What's in here

```
crates/batuta/        the hot-path Rust binary — no dependencies, no network
  src/                BM25 router, inverted index, event log
  tests/              the CONFORMANCE BATTERY — 15 tests, the contract for ports
portal/               static Next.js (Vercel) — ranking, recipes, arena, records
sql/                  Neon schema + the hash chain with an anti-edit trigger
schema/               JSON Schema for the local event and the daily summary that gets uploaded
bateria/v1/           24 frozen tasks with acceptance criteria written beforehand
docs/PROTOCOLO.md     the Batuta Zero protocol and the judge's three laws
script/cadeia.mjs     append, verify, and stamp the hash chain
npm/                  ten-line wrapper that downloads the binary
hooks/                the UserPromptSubmit hook
registros/            the published chain — verifiable by anyone
```

## Measured numbers

Measured on 08/24/2026, not estimated:

| | |
|---|---|
| indexing 506 skills | **91 ms** |
| 50 routes (process startup included) | **136 ms** total, ~2.7 ms each |
| index size | 397 KB |
| conformance battery | 15 of 15 green |

The hot-path budget is 100 ms per turn, with a hard ceiling of 300 ms.

## The rules that aren't negotiable

1. **Zero profit.** Nobody earns anything — not founders, not contributors.
2. **The prompt never leaves your machine.** Only a hash with a local salt, and the
   salt is never sent.
3. **The binary never touches the network.** The wrapper handles networking.
4. **Silence over noise.** A false positive costs more than a false negative.
5. **The judge is blind, is not the defendant, and is versioned.**
6. **A control group exists.** 5% of turns have the router deliberately silenced —
   declared, configurable, and can be turned off.
7. **The chain cannot be edited.** Every result carries the previous one's hash, and
   the top is stamped outside our control.

Details on each: [MANIFESTO.md](MANIFESTO.md) and [SPEC.md](SPEC.md).

## Contributing

What's worth more than code, in this order:

1. **Install it and turn on submission** — sample size is the scarce input, not money.
2. **Send a real task** to the [arena](https://batuta.space/arena).
3. **Run the Batuta Zero protocol** and publish the raw output.
4. **Find a flaw in the method** and open an issue. Credibility is the only product.

Porting the hot path to another language is also worth doing — and a port is
conformant when it passes `crates/batuta/tests/conformidade.rs` with the exact same
numbers.

## Running the tests

```sh
cd crates/batuta
cargo test -- --test-threads=1     # the battery shares one temp home directory
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

## License

MIT. See [LICENSE](LICENSE).

Every contributor's name goes into the portal and the dataset — next to the number
they helped produce, not into some generic acknowledgments list.

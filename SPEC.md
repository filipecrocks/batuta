# SPEC — the hot-path contract

This document and `crates/batuta/tests/conformance.rs` are **the contract**. A port
to another language is conformant when it passes the battery with the exact same
numbers — not with similar numbers.

Contract version: **1** · frozen on 08/24/2026.

---

## 1. The boundary

**The binary only does what needs to be deterministic, local, and in milliseconds.
Everything else is a skill — and like any skill, it gets measured.**

| | hot path | cold path |
|---|---|---|
| commands | `route`, `log`, `index` | `report`, `summary`, `find`, `conflicts` |
| network | **forbidden** | allowed (but not in the binary — see §7) |
| LLM | **forbidden** | allowed |
| budget | 100ms, hard ceiling 300ms | no budget |

Breaking a task into blocks, formatting the delivery, rewriting the prompt — none of
that goes into the binary. It becomes a candidate skill and goes through testing
like any other.

## 2. Tokenization

A single path for both indexing and querying. If the two ends diverge, the router
lies.

1. Lowercases and **strips accents** (á→a, ç→c, ñ→n, …).
2. Splits on any non-alphanumeric character.
3. Discards tokens under 2 characters.
4. Discards **glue words** (a fixed pt+en list in the code; without it, noise-cutting
   becomes decoration).
5. Discards digit-only tokens.
6. For tokens **longer than 5** characters, also emits the **5-character prefix**.

Step 6 replaces the stemmer. "quebrou" and "quebrado" (broke / broken) meet at
"quebr", and the cost is a string slice instead of a suffix table on the hot path.
Words of 5 characters or fewer **do not** get a prefix — otherwise "casa" (house)
and "caso" (case) would become the same thing.

## 3. Indexing

One document per `SKILL.md` found. The bag of words is:

```
name + folder-name    × 3
description            × 2
body (400 terms)       × 1
```

The body is included because of the **SkillRouter** paper (arXiv 2603.22455):
ranking by name + description alone drops routing accuracy by **31 to 44 percentage
points** on a benchmark of ~80,000 overlapping skills. On the local hot path (10 to
100 skills) the difference probably disappears; in `batuta find`, over the public
registry, it changes everything. Indexing both sides the same way costs nothing,
and it avoids the gap down the road.

The 400-term cap on the body is the second safety belt: BM25's `B=0.75` already
penalizes long documents.

### Index format — `~/.batuta/indice.txt`

One line per record, not JSON. Measured reason: the hot path has a **full** 100ms
budget, and only the `P` lines for the query's terms need to be opened. JSON would
force parsing the whole file.

```
BATUTA-INDICE 1
G <generation epoch>
N <number of skills>
A <average document length>
S <i>\t<name>\t<version>\t<description>\t<path>\t<origin>\t<size>
P <term>\t<i>:<tf>,<i>:<tf>,...
```

A term's `df` = the number of pairs on its `P` line.

## 4. Scoring — BM25

```
idf(t)   = ln(1 + (N - df + 0.5) / (df + 0.5))
score(d) = Σ_t idf(t) · (tf · (K1+1)) / (tf + K1 · (1 - B + B · |d|/avgdl))
```

| parameter | value | why |
|---|---|---|
| `K1` | **1.5** | standard default; validated in v0.1 |
| `B` | **0.75** | standard default; penalizes long documents |
| `CORTE_RUIDO` | **2.0** | at 3.2 the router went silent on 3 of 7 legitimate cases |
| `MAX_SUGESTOES` | **3** | each skill costs ~53 tokens in context |
| `FRACAO_DO_TOPO` | **0.55** | anything below 55% of the top score doesn't keep up |

A term repeated in the query counts **once**. Ordering: score descending, ties
broken by ascending index — determinism is a requirement, not a convenience.

**Silence over noise.** A turn with no clear match = a silent router. A false
positive costs more than a false negative: a skill suggested for no reason enters
the context, spends tokens, and teaches the model to ignore the suggestion.

## 5. Causal holdout

In `holdout_pct`% of turns (default **5**) the router deliberately stays silent.

```
h = sha256(local_salt ‖ 0x1F ‖ "holdout|" ‖ prompt)
falls_in_holdout = (first 4 hex chars of h, as u32) % 100 < holdout_pct
```

Deliberately deterministic: the same question always lands in the same arm, so you
can't just retry until the router speaks.

Non-negotiable conditions: **declared** to the user up front on first run,
**configurable**, **can be turned off**. A hidden experiment destroys the project.

## 6. Privacy — what gets logged

The route event logs:

| field | what it is |
|---|---|
| `prompt_hash` | 32 hex chars of `sha256(local_salt ‖ 0x1F ‖ prompt)` |
| `prompt_len` | character count |
| `termos` | how many terms survived tokenization |
| `holdout`, `modo`, `ms`, `sugestoes` | decision metadata |

**The prompt text is never logged or transmitted.** The salt is generated once,
lives at `~/.batuta/sal` with 0600 permissions, and is **never sent** — without it,
nobody can test a guessed prompt against the published hash.

What gets uploaded (and only with explicit opt-in) is the **daily summary
aggregated per skill**, schema `batuta.resumo_diario.v1` — never the raw event. 200
turns/day become ~20 lines.

## 7. Network

**The binary never touches the network. Ever.** The npm wrapper
(`batuta registro atualizar`) is what downloads the public registry; the binary
only reads the cached file. This keeps the hot path auditable by inspection —
there's no socket to review.

## 8. Transports — one brain, three mouths

1. **`UserPromptSubmit` hook** — the primary one. Deterministic; stdout goes into
   the context; blocks the turn; a timeout discards the whole output. That's why
   the hook stays silent with exit code 0 whenever anything goes wrong.
2. **MCP** — chat and Cowork, where there's no hook. The data is born tagged
   `modo: degradado` (degraded mode).
3. **Skill** — the weakest fallback.

## 9. The funnel

```
route  →  activate  →  outcome
```

- **route** — Batuta proposed it
- **activate** — the skill actually fired (`PostToolUse` on the Skill tool; the OTEL
  event `claude_code.skill_activated` distinguishes user from model)
- **outcome** — did the turn end well? Hard proxies (reprompt, error, retry), a
  one-key vote, an overnight judge

Metrics: fire rate (`activate ÷ route`) · ghost skill (0 activations in N turns) ·
lift against the holdout · **cost per completed task** — the metric nobody has,
because a skill can make the call more expensive while making the task cheaper by
killing reprompts.

## 10. The battery

`crates/batuta/tests/conformidade.rs`, 15 tests, run with `--test-threads=1`.

| # | what it locks down |
|---|---|
| c01 | sha256 against known vectors, including multi-block |
| c02 | double accents, glue words excluded, stray numbers excluded |
| c03 | the 5-character prefix, and short words **without** a prefix |
| c04 | frontmatter with an indented continuation |
| c05 | the index survives a round trip to disk; a partial read materializes only the requested terms |
| c06 | 5 legitimate queries rank the right skill first |
| c07 | 5 noise cases leave the router silent |
| c08 | K1, B, the cutoff, the ceiling, and the 400-term cap are frozen |
| c09 | determinism |
| c10 | the holdout is deterministic and within range (5% ± sample variance over 2000 draws) |
| c11 | the prompt never appears in the event, and the hash changes with the salt |
| c12 | the daily summary carries no prompt hash and no turn id |
| c13 | canonical JSON (sorted keys) and round-trip |
| c14 | UTC dates |
| c15 | 506 skills within budget |

The reproducible contract is a release-build route average below 50 ms over the
frozen 500+ skill corpus, with an independent 300 ms hook deadline. Run
`script/benchmark.sh`; it records the commit, dirty state, toolchain, OS, CPU,
architecture, profile, and measured result. The benchmark is explicitly
in-process and does not claim process-startup coverage. Historical ad-hoc numbers
without that metadata are not product claims.

## 11. What v0.1 in Node taught us

An early Node prototype showed that process startup could dominate the algorithm,
which motivated the static Rust hot path. That historical observation was not a
controlled benchmark; use the committed benchmark script for current claims.

If 300ms ever isn't enough, plan B is a daemon with a unix socket. It's plan B, not
plan A.

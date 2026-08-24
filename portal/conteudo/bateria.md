# Canonical battery v1

24 tasks frozen in `tarefas.json`. Statement, inputs, acceptance criteria, and
verifier enter the repository as code: versioned, immutable within the
version, reviewable by anyone.

- `schema`: `batuta.bateria.v1`
- `versao`: `1.0.0`
- `congelada_em`: `2026-08-24`

---

## Why freeze it

Without a frozen battery, no number is comparable — and a non-comparable number is
marketing.

Three things break when the task changes mid-stream:

1. **The historical series dies.** If today's statement isn't yesterday's, the
   difference measured between two models might just be the difference between two pieces of text.
2. **The experiment turns into cheerleading.** Whoever writes the task after seeing the output
   writes the task the output wins. That's exactly the vice §2 of the dossier
   documents in the market: every router scores its own goal with its own ruler.
3. **The acceptance criteria stops being a criterion.** Criteria written afterward is
   rationalization.

That's why: **acceptance criteria is born together with the task**, before any round,
and each criterion can be answered yes or no by someone who didn't watch the output
being generated. None of "well written," "high quality," "adequate."

---

## What's inside each task

```json
{
  "id": "cod-02",
  "categoria": "codigo",
  "complexidade": "media",
  "titulo": "...",
  "enunciado": "texto EXATO enviado ao modelo, idêntico nos dois braços",
  "insumos": [{"nome": "...", "descricao": "...", "gerador": "comando shell determinístico"}],
  "criterio_aceite": ["...", "..."],
  "verificacao": "automatica | juiz | mista",
  "verificador": "comando de shell que sai 0 (aprovado) ou != 0 (reprovado)",
  "skills_candidatas": ["systematic-debugging", "test-driven-development"],
  "teto_turnos": 5,
  "observacao": "o que a tarefa está medindo de fato"
}
```

Rules the v1 battery follows, and that any future version must follow too:

- **6 categories × 4 tasks = 24.** In each category: 1 simple, 2 medium, 1
  complex. Categories: `codigo`, `escrita`, `dados`, `documentos`, `pesquisa`,
  `automacao`.
- **The 4 `codigo` tasks are `automatica`**, with a real verifier (a test that
  passes or doesn't). That's what makes Phase 1 nearly free.
- **The statement never names a skill.** No "use skill X." The arm with the skill is
  distinguished by the environment, never by the text. Identical statement, word for
  word, in both arms.
- **Short statement**: 2 to 8 lines. A complex task gets more input, not more
  prose.
- **Zero network, zero account on an external service, zero current date.** Where the date
  matters (`aut-03`), it comes in via an environment variable (`DATA_REF`), not the
  system's `date`.
- **`skills_candidatas` is a declared hypothesis**, not an instruction: it's what the task
  *should* trigger. When the router doesn't trigger any of them and the result still goes up
  anyway, that's data too.

### v1 distribution

| category | simple | medium | complex | verification |
|---|---|---|---|---|
| `codigo` | cod-01 | cod-02, cod-03 | cod-04 | 4 automatic |
| `escrita` | esc-01 | esc-02, esc-03 | esc-04 | 3 mixed, 1 judge |
| `dados` | dad-01 | dad-02, dad-03 | dad-04 | 4 mixed |
| `documentos` | doc-01 | doc-02, doc-03 | doc-04 | 4 mixed |
| `pesquisa` | pes-01 | pes-02, pes-03 | pes-04 | 2 mixed, 2 judge |
| `automacao` | aut-01 | aut-02, aut-03 | aut-04 | 4 mixed |

Total: 4 automatic, 17 mixed, 3 judge-only.

---

## How to run it

**Run-environment prerequisites:** `bash`, `python3` (3.11+, standard library
only), `make`, `tar`, `unzip`. Nothing else. No network.

Each run is its own empty, disposable directory. The cycle is always the same:

1. **Prepare the directory.** Run, in order, each `gerador` of the task's
   `insumos`, with the run's directory as the current directory. The generator is
   deterministic: same command, same byte.
2. **Deliver the statement.** Send `enunciado` to the model, not one word
   more. The arm's environment (with skill / without skill / with recipe) is the only
   difference between runs of the same task.
3. **Let it work** up to `teto_turnos`. If it exceeds the cap without delivering, the
   run is recorded as failed by cap, not discarded.
4. **Verify.** Run the `verificador` with `bash -e`, with the run's directory
   as the current directory and the inputs already in place. Exit code `0` = passed.
5. **Judge**, when `verificacao` is `juiz` or `mista`, following
   `docs/PROTOCOLO.md` — blind, cross, versioned.
6. **Record the raw data**: statement, inputs, output, verifier exit code,
   judge's verdict, tokens, cost, turns.

The verifier covers what's countable. The judge covers the rest of the `criterio_aceite`.
On a `mista` task, **a failed verifier ends the run**: the judge isn't asked
to salvage output that already failed the objective.

### Phase 1: only the `codigo` slice

Phase 1 runs **only the 4 `codigo` tasks**, and only afterward opens up to the rest.
The reason is the dossier's (§12): the code judge is nearly free, because a test passes
or it doesn't. Validating the method on objective ground before spending judgment on
subjective ground is what separates measurement from opinion.

Order in which slices open, after the 1st: `dados` and `automacao` (strong
verifier), then `documentos`, then `escrita` and `pesquisa`.

---

## Arm

Arm is **what changes in the environment**, with the statement held fixed. v1 defines three:

| arm | what's turned on |
|---|---|
| `sem-nada` | plain model, no skill installed, router silent |
| `com-skill` | only the task's `skills_candidatas` installed and routable |
| `com-receita` | the whole recipe installed (6-10 skills pinned to a version, §5) |

The main matrix runs **2 arms** — `sem-nada` and `com-skill`. `com-receita`
comes in once a published recipe exists with evidence attached.

Record, on every run: which arm, which skills were installed, which one actually
fired (`activate`), and each one's version. An installed skill that didn't
fire is a ghost skill, and that's a result — not an execution error.

---

## The "channel doesn't multiply" rule (§7, rule 2)

The main matrix runs **on a single channel**: OpenRouter, the unified API. The matrix is not
multiplied by channel.

The reason is arithmetic and hygiene. Arithmetic: 24 tasks × 2 arms × 6 models
is already ~300 runs/month; multiplying by 4 channels gets to 1,200 and nothing stays
comparable to anything. Hygiene: the channel changes default temperature, effective
context window, version served, and output limit, and none of those is what
the battery wants to measure.

Channel becomes a **separate, declared test**: same task, same model, same
arm, different channels (subscription, direct API, OpenRouter, OpenCode…). If a
difference shows up, it's news in its own right — and it's published as such, not mixed
into the main number.

Every published row carries the channel. A number without a declared channel doesn't go into
the dataset.

---

## The math

```
24 tasks × 2 arms × 6 models ≈ 288 runs/month
```

Rounding with tie-break repetitions: **≈ 300 runs/month**, some tens
of dollars via API.

v1 models, by tier (each one's exact name lives in the run manifest, not
here — the model changes, the tier doesn't): 2 top-tier paid, 2 mid-tier,
1 small, 1 free/local.

Phase 1, `codigo` only: `4 × 2 × 6 = 48 runs`, and 48 automatic verifications — no
judge cost.

---

## Monthly rotation

Every month: **5 tasks come in, 5 go out, with a changelog.** Matches the cycle of 5
new skills per month.

Rotation rules:

1. **The version bumps.** `1.0.0` → `1.1.0` at every rotation. A material error fix
   in a statement or verifier bumps the patch (`1.0.1`) and is announced as a
   correction, never applied silently.
2. **The shape stays the same.** After rotation it's still 6 categories × 4
   tasks, 1 simple / 2 medium / 1 complex in each. A medium one leaves, a
   medium one comes in.
3. **Whoever leaves, leaves for a written reason.** Valid reasons: saturated (every arm
   passes or every arm fails, it no longer discriminates), leaked (the statement showed up in a
   public corpus), broke (the verifier depends on something that changed in the environment),
   or turned out ambiguous in practice.
4. **A retired task isn't deleted.** It leaves the active battery and stays in
   `CHANGELOG.md` with the version it entered in and the version it left in. The old
   results remain valid for the range of versions it was active in.
5. **Never rotate mid-series.** Rotation happens at a version turnover, with
   all runs of the previous version closed out.

Every `CHANGELOG.md` entry carries: version, date, tasks that came in (with id,
category, complexity, and origin), tasks that left (with reason), and the hash of the
previous version's `tarefas.json` — the same hash chain from §8 of the dossier.

---

## How a new task gets in

Coming from the arena (§10), always through the same funnel:

```
Submission → Triage → Canonization → Vote → Trial → Publication
```

- **Triage.** Dedupe, security, no hidden executables, nothing that needs
  network or an account access. Only what's reproducible on a machine disconnected from the
  internet comes out of here.
- **Canonization — the gate that matters.** *A submitted task NEVER runs as it arrived.*
  It's rewritten into this battery's format: a self-contained 2-to-8-line statement,
  inputs with a deterministic generator, a verifiable acceptance criterion, category,
  complexity, a verifier when possible. Whoever submits suggests the problem; **the ruler is
  ours** — a skill author doesn't get to submit the task their skill wins.
- **Vote.** Decides the test queue, never the result. Vote ≠ score.
- **Trial run before entry.** Every candidate task runs once in each arm,
  outside the battery, against at least 2 models from different tiers. If everyone
  passes or everyone fails, it doesn't discriminate and goes back to the rewrite queue.
- **Verifier before freezing.** No task enters without the verifier having been
  tested both ways: passing a correct reference solution **and** failing a missing or
  wrong one. A verifier that's only been tested on the happy path isn't a verifier.
- **Entry.** Only at the next version turnover, in the place of a task that left, with
  named credit to whoever submitted it in `CHANGELOG.md` and in the dataset.

---

## What can never happen in this folder

- Editing `enunciado`, `insumos`, `criterio_aceite`, or `verificador` of `1.0.0`
  after the first published run. If it changed, it's another version.
- A statement that names a skill, router, model brand, or Batuta itself.
- Acceptance criteria that needs an opinion to be answered.
- A task that depends on the network, a credential, or today's date.
- A verifier that reads the arm's name, the model's, or any label. The
  verifier sees files, and only files.
- A published result without channel, without battery version, and without judge version.

---

## Files

```
bateria/v1/
├── tarefas.json    # the 24 frozen tasks
└── README.md       # this file
```

The execution protocol, blind judging, and the causal holdout are in
`docs/PROTOCOLO.md`.

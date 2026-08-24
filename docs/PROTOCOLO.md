# PROTOCOL — Batuta Zero

Executable procedure for Batuta's first experiment. Written for Filipe to
run alone, start to finish, without having to decide anything along the way.

**Size of the first batch:** 5 tasks × 4 models × 2 arms = **40 runs**
(≈ 1 week).

The zero data point isn't valuable for its result. It's valuable for being the world's
first number about skills produced with randomized order, a clean session, blind judging, and published raw data.
If the protocol slips, the data becomes garbage — and garbage published with a
measurement stamp is worse than no data at all.

---

## 0. Before starting

### 0.1 The five tasks

No new task gets written for Zero. The frozen battery is used, so the
first data point is already comparable with everything that comes after.

| Zero code | v1 battery task | category | verification |
|---|---|---|---|
| `z-01` | `cod-01` | codigo | automatic |
| `z-02` | `cod-02` | codigo | automatic |
| `z-03` | `cod-03` | codigo | automatic |
| `z-04` | `cod-04` | codigo | automatic |
| `z-05` | `esc-01` | escrita | mixed |

Four automatic ones give the number almost for free. The fifth exists so the
blind-judging procedure actually runs for real in this batch, instead of debuting in
production.

### 0.2 The four models

One per tier. The exact name goes into `manifesto.json` (step 1.3), not this
document — the model changes, the tier doesn't.

| id | tier |
|---|---|
| `m1` | top-tier paid |
| `m2` | mid tier |
| `m3` | small |
| `m4` | free / local |

Single channel for all 40 runs: **OpenRouter**. See "channel doesn't multiply"
in `bateria/v1/README.md`.

### 0.3 The two arms

| id | what's turned on |
|---|---|
| `A` | `sem-nada` — no skill installed, router off |
| `B` | `com-skill` — only the task's `skills_candidatas`, router on |

The statement is **identical, word for word**, in both. The difference lives in the
environment and nowhere else.

---

## 1. Steps

### Step 1 — Fix the ground (once, before any run)

**1.1 Create the structure.**

```bash
mkdir -p ~/batuta-zero/{tarefas,rodadas,cego,vereditos,publicacao}
cd ~/batuta-zero
```

**1.2 Publish the seed, before anything else.**

The seed is what makes the randomization auditable: anyone can redo the randomization and
must arrive at the same order.

```bash
SEED="batuta-zero-v1-$(date +%Y-%m-%d)-$(head -c 8 /dev/urandom | xxd -p)"
printf 'SEED=%s\n' "$SEED" > SEED.txt
cat SEED.txt
git add SEED.txt && git commit -m "batuta zero: semente publicada antes da primeira rodada"
git push
```

The seed's commit **comes before** the first run. A seed published afterward is
worthless: whoever publishes it later picks the seed that gives the order they want.

**1.3 Freeze the batch's manifest.**

```bash
cat > manifesto.json <<'JSON'
{
  "leva": "batuta-zero-1",
  "bateria": "batuta.bateria.v1@1.0.0",
  "canal": "openrouter",
  "tarefas": ["cod-01", "cod-02", "cod-03", "cod-04", "esc-01"],
  "modelos": {
    "m1": {"faixa": "topo-pago",    "id_canal": "PREENCHER", "versao": "PREENCHER"},
    "m2": {"faixa": "media",        "id_canal": "PREENCHER", "versao": "PREENCHER"},
    "m3": {"faixa": "pequeno",      "id_canal": "PREENCHER", "versao": "PREENCHER"},
    "m4": {"faixa": "gratis-local", "id_canal": "PREENCHER", "versao": "PREENCHER"}
  },
  "bracos": {"A": "sem-nada", "B": "com-skill"},
  "temperatura": 0,
  "teto_turnos": "o teto_turnos de cada tarefa em tarefas.json",
  "holdout_causal": "desligado nesta leva (ver secao 5)"
}
JSON
```

Fill in the `PREENCHER` placeholders with each model's identifier and the version
served, copied from the channel. Commit before the first run.

**1.4 Extract the five statements, word for word.**

```bash
python3 - <<'PY'
import json, pathlib
b = json.load(open('/caminho/para/batuta/bateria/v1/tarefas.json', encoding='utf-8'))
alvo = {'cod-01': 'z-01', 'cod-02': 'z-02', 'cod-03': 'z-03',
        'cod-04': 'z-04', 'esc-01': 'z-05'}
for t in b['tarefas']:
    if t['id'] in alvo:
        p = pathlib.Path('tarefas') / (alvo[t['id']] + '.md')
        p.write_text(t['enunciado'] + '\n', encoding='utf-8')
        print(p, len(t['enunciado']), 'caracteres')
PY
sha256sum tarefas/*.md > tarefas/CHECKSUMS.txt
git add tarefas && git commit -m "batuta zero: enunciados congelados" && git push
```

From here on, `tarefas/*.md` is law. Check the checksums before each day of
runs:

```bash
sha256sum -c tarefas/CHECKSUMS.txt
```

If it fails, the series is contaminated: stop everything and start over (section 4).

---

### Step 2 — Randomize the order of the arms, deterministically

Always running arm B first measures warm-up, not skill. The order of each pair
(task × model) is randomized — and the randomization comes from the seed, not from a
finger in the air.

**2.1 The randomization function.**

```bash
. ./SEED.txt

braco_primeiro () {   # $1 = tarefa, $2 = modelo
  h=$(printf '%s|%s|%s' "$SEED" "$1" "$2" | sha256sum | cut -c1-8)
  if [ $(( 0x$h % 2 )) -eq 0 ]; then echo "A B"; else echo "B A"; fi
}
```

**2.2 Generate the plan for the 20 pairs (40 runs).**

```bash
: > plano.tsv
for t in z-01 z-02 z-03 z-04 z-05; do
  for m in m1 m2 m3 m4; do
    printf '%s\t%s\t%s\n' "$t" "$m" "$(braco_primeiro "$t" "$m")" >> plano.tsv
  done
done
cat plano.tsv
sha256sum plano.tsv > plano.sha256
git add plano.tsv plano.sha256 && git commit -m "batuta zero: plano sorteado" && git push
```

The plan is reproducible: whoever has `SEED.txt` runs the same commands and gets
`plano.tsv` byte-for-byte identical. That's what makes "randomized" mean something.

**2.3 Order of runs on the day.** Follow `plano.tsv` top to bottom. Don't skip a
line because "this one will take a while." Skipping on the spot is choosing.

---

### Step 3 — Run a run (repeat 40 times)

Each run has an identifier: `<tarefa>-<modelo>-<braco>`, for example
`z-02-m3-B`.

**3.1 Clean directory.**

```bash
R="z-02-m3-B"                      # trocar a cada rodada
rm -rf "rodadas/$R"
mkdir -p "rodadas/$R/trabalho"
cd "rodadas/$R/trabalho"
```

**3.2 Generate the inputs.** Run, in order, each task `gerador` in
`tarefas.json`, with `trabalho/` as the current directory. Check:

```bash
ls -la
sha256sum * > ../INSUMOS.sha256
```

The same inputs, byte for byte, in both arms. If the checksums for A and B differ,
the pair is burned and gets redone entirely.

**3.3 Clean session. No exception.**

- New window, new conversation, zero history.
- None of "continue from there," none of "same as last time."
- In arm A: no skill installed and router off — check, don't assume.
- In arm B: **only** the task's `skills_candidatas` installed.
- Temperature 0, or the minimum the channel accepts; note which it was.
- Between the A run and the B run of the same pair, close the client entirely.

Check before pasting the statement:

```bash
ls ~/.claude/skills 2>/dev/null || echo "(nenhuma skill instalada)"
```

**3.4 Paste the statement.** `cat ../../../tarefas/z-02.md` and paste it. Nothing
before, nothing after. No "please," no "do a great job," no "use skill X." If the model
asks something, answer **only** with what's already in the statement or the inputs;
if the answer isn't there, answer "follow the statement" and log the question
in `meta.json`.

**3.5 Let it work** up to the task's `teto_turnos`. If it exceeds it without delivering:
log `reprovada_por_teto`. That's not a discard — it's a result.

**3.6 Save the raw output.**

```bash
cd ..
mkdir -p saida
cp -a trabalho/. saida/            # todos os arquivos produzidos
# e a transcrição completa da conversa, exportada do cliente:
#   saida/transcricao.md
```

**3.7 Run the verifier** (tasks `automatica` and `mista`):

```bash
cd trabalho
bash -e -c "$(python3 -c "
import json;b=json.load(open('/caminho/para/batuta/bateria/v1/tarefas.json',encoding='utf-8'))
print([t for t in b['tarefas'] if t['id']=='cod-02'][0]['verificador'])")"
echo "codigo de saida: $?"
cd ..
```

**3.8 Close out the record** of the run in `meta.json` (schema from section 3).

**3.9 Go back to the root** and move to the next line of the plan.

---

### Step 4 — Anonymize for blind judging

Blind judging **including Filipe**. Whoever knows which output is from the skill arm
finds quality in it — not out of bad faith, just from being human.

**4.1 Scan for self-disclosure.** The output sometimes gives itself away ("as X's
assistant…", "following skill Y…"). This isn't erased from the raw data; it's replaced
**in the blind copy**, and the replacement is logged.

```bash
grep -rniE 'skill|claude|gpt|gemini|llama|mistral|anthropic|openai' rodadas/*/saida/ \
  > cego/autodelacao.log || true
wc -l cego/autodelacao.log
```

**4.2 Generate the blind copies with an opaque code.**

```bash
: > mapa.tsv
for d in rodadas/*/; do
  R=$(basename "$d")
  COD=$(head -c 12 /dev/urandom | xxd -p)
  printf '%s\t%s\n' "$COD" "$R" >> mapa.tsv
  mkdir -p "cego/$COD"
  cp -a "$d/saida/." "cego/$COD/"
  # substituições da 4.1, aplicadas SÓ na cópia cega:
  grep -rlZ -iE 'skill|claude|gpt|gemini|llama|mistral|anthropic|openai' "cego/$COD" 2>/dev/null \
    | xargs -0 -r sed -i -E 's/(skill|claude|gpt|gemini|llama|mistral|anthropic|openai)/[REDIGIDO]/Ig'
done
```

**4.3 Seal the map before looking at any output.**

```bash
sha256sum mapa.tsv > mapa.sha256
git add mapa.sha256 && git commit -m "batuta zero: mapa selado antes do julgamento" && git push
mv mapa.tsv ~/.batuta-zero-mapa-selado.tsv     # fora da pasta de trabalho
chmod 400 ~/.batuta-zero-mapa-selado.tsv
```

The hash goes to the repository **before** judging. The file leaves the folder. In
the end, the map is published and anyone can check it's the same one that was sealed.
That's what stops a convenient version of the map from showing up later.

**4.4 Shuffle the judging order, also via the seed.**

```bash
. ./SEED.txt
ls cego | grep -v autodelacao.log | LC_ALL=C sort \
  | shuf --random-source=<(openssl enc -aes-256-ctr -pass "pass:$SEED" -nosalt </dev/zero 2>/dev/null) \
  > ordem_julgamento.txt
head ordem_julgamento.txt
```

Judge in that order, top to bottom, without peeking at the whole list beforehand.

---

### Step 5 — Judge

**5.1 What gets judged.** For each code in `ordem_julgamento.txt`, open
`cego/<codigo>/`, read the corresponding task in `tarefas/` (the code doesn't say
which one it is; the folder's content does) and answer **yes or no** to each item of
that task's `criterio_aceite`. No overall score before the items.

**5.2 Record the verdict** in `vereditos/<codigo>.json` (schema in section 3).

**5.3 No going back.** A recorded verdict doesn't get reopened after the map is
revealed. If second-guessing hits, it goes in as a public observation, not as a
correction.

**5.4 Only after the 40 verdicts**, reveal the map — checking first that it's the
same one that was sealed:

```bash
cp ~/.batuta-zero-mapa-selado.tsv mapa.tsv
sha256sum -c mapa.sha256        # tem que imprimir: mapa.tsv: OK
```

If it says `FAILED`, **the whole batch is discarded and published as discarded**, with
the reason written down. A published discard is worth more than a saved result.

Only with `OK` on screen does the verdict get joined with the run:

```bash
join -1 1 -2 1 -t $'\t' <(LC_ALL=C sort mapa.tsv) \
     <(for v in vereditos/*.json; do
         printf '%s\t%s\n' "$(basename "$v" .json)" \
           "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["aprovada"])' "$v")"
       done | LC_ALL=C sort) > resultados.tsv
cat resultados.tsv
```

---

### Step 6 — Publish the raw data

What separates Batuta from a self-proclaimed README: anyone can redo the judging
and disagree.

```bash
mkdir -p publicacao
cp -a tarefas manifesto.json SEED.txt plano.tsv mapa.tsv mapa.sha256 \
      vereditos ordem_julgamento.txt publicacao/
for d in rodadas/*/; do
  R=$(basename "$d")
  mkdir -p "publicacao/rodadas/$R"
  cp -a "$d/saida" "$d/meta.json" "$d/INSUMOS.sha256" "publicacao/rodadas/$R/"
done
python3 -c "import pathlib,hashlib;[print(hashlib.sha256(p.read_bytes()).hexdigest(), p) for p in sorted(pathlib.Path('publicacao').rglob('*')) if p.is_file()]" > publicacao/MANIFEST.sha256
git add publicacao && git commit -m "batuta zero leva 1: cru completo" && git push
```

For each pair, the publication carries: **the statement + both outputs + the
verdict**. Plus the randomized plan, the seed, the sealed map, and the checksums.

Chain it to the hash of the previous publication and stamp the top on OpenTimestamps,
per §8 of the dossier.

---

## 2. THE JUDGE

### 2.1 The three laws

**Law 1 — Blind.** The judge doesn't know whether the skill fired, which arm
produced the output, or which model wrote it. If it knows, it confirms what we want to
hear and the number dies. This applies to the judge-model and it applies to Filipe.

**Law 2 — Not the defendant.** A model never judges its own output. Judging is
**cross, always**. Pairs for batch 1:

| output from | judged by |
|---|---|
| `m1` (top-tier paid) | `m2` |
| `m2` (mid-tier) | `m1` |
| `m3` (small) | `m1` |
| `m4` (free/local) | `m2` |

No model appears in both columns of the same row. The judge-model is from the top
tier because judging is cheaper than producing — the judge's cost isn't the bottleneck.

**Law 3 — Versioned.** Recorded alongside **every** verdict: the judge-model's
identifier, the exact version served by the channel, **the judge's entire prompt** (not a
summary, not a link — the text), the temperature, and that prompt's hash. A judge that
changes without a changelog invalidates the whole historical series, retroactively.

Every time the judge's prompt changes: new version (`juiz-v1` → `juiz-v2`), a
changelog entry, and previous series stay marked with the old version. The past isn't
recalculated with the new judge — it's recalculated and **both** series are published,
declaring which is which.

**The judge is a signal, not truth.** It sits alongside the hard proxies (reprompt, error,
retry, the verifier's exit code). Where the verifier fails, the judge isn't
consulted: output that failed the objective doesn't get saved by the conversation.

### 2.2 Rubric by category

The rubric doesn't replace `criterio_aceite` — it comes **after** it. First the
judge answers yes/no to each criterion; the rubric is only applied to outputs that
passed every criterion, to separate "met it" from "met it
well." Each axis is worth 0, 1, or 2.

**`codigo`** — the verifier already said whether it passes. The rubric looks at the rest:
1. *Survival*: handles empty input, boundary, and wrong type without breaking.
2. *Readability*: a human finds the defect in under 2 minutes.
3. *Restraint*: didn't rewrite what wasn't asked for, didn't bring in a new dependency.

**`escrita`**:
1. *Factual fidelity*: no fact was added, removed, or changed value.
2. *Serves the declared reader*: the statement's addressee understands without rereading.
3. *Density*: every sentence carries information; none exists just to sound good.

**`dados`**:
1. *Correct number*: matches what's recomputed from the input.
2. *Declared method*: you can redo the math by reading what it wrote.
3. *Edge-case handling*: ties, missing values, duplicates, and impossible values
   got an explicit decision.

**`documentos`**:
1. *Real format*: the file opens in the target program, it's not something else with
   a swapped extension.
2. *Requested structure*: sections, order, and counts match the statement.
3. *Traceability*: every filled field has a traceable origin in the input.

**`pesquisa`**:
1. *Anchoring*: every claim carries where it came from.
2. *Declares the gap*: what the material doesn't answer shows up as unanswered,
   instead of being filled in with plausibility.
3. *Tension acknowledged*: where sources disagree, the disagreement is named, not
   smoothed over.

**`automacao`**:
1. *Idempotence*: running it twice breaks nothing.
2. *Visible failure*: breaks with a non-zero exit code and a message in the right place.
3. *Resumability*: the state lets it continue from where it stopped, without redoing
   what's already done.

Final scale per output: `aprovada` (every criterion yes) or `reprovada` (any
no), plus the rubric total from 0 to 6. **Approval is the main number.** The
rubric is a tiebreaker and only ever gets published alongside approval, never alone.

### 2.3 What gets recorded alongside the verdict

```json
{
  "juiz": {
    "modelo": "PREENCHER",
    "versao_servida": "PREENCHER",
    "canal": "openrouter",
    "temperatura": 0,
    "prompt_versao": "juiz-v1",
    "prompt_sha256": "PREENCHER",
    "prompt_integral": "PREENCHER — o texto inteiro, sem corte"
  }
}
```

A verdict without `prompt_integral` doesn't enter the dataset. There's no
"the prompt is long" exception.

---

## 3. Record schemas

### 3.1 `rodadas/<id>/meta.json` — one per run

```json
{
  "rodada_id": "z-02-m3-B",
  "leva": "batuta-zero-1",
  "bateria": "batuta.bateria.v1@1.0.0",
  "tarefa_bateria": "cod-02",
  "tarefa_zero": "z-02",
  "categoria": "codigo",
  "complexidade": "media",
  "modelo": "m3",
  "modelo_id_canal": "PREENCHER",
  "modelo_versao_servida": "PREENCHER",
  "canal": "openrouter",
  "temperatura": 0,
  "braco": "B",
  "braco_nome": "com-skill",
  "ordem_na_dupla": 1,
  "ordem_sorteada_por": "sha256(SEED|tarefa|modelo)",
  "skills_instaladas": [{"nome": "systematic-debugging", "versao": "PREENCHER"}],
  "skills_que_dispararam": ["systematic-debugging"],
  "roteador": {"ativo": true, "versao": "PREENCHER", "holdout_causal": false},
  "sessao_limpa": true,
  "insumos_sha256": "conteudo de INSUMOS.sha256",
  "enunciado_sha256": "PREENCHER",
  "turnos_usados": 3,
  "teto_turnos": 5,
  "reprompts": 1,
  "erros_de_ferramenta": 0,
  "tokens_entrada": 0,
  "tokens_saida": 0,
  "custo_usd": 0.0,
  "duracao_s": 0,
  "verificador_codigo_saida": 0,
  "desfecho": "aprovada | reprovada | reprovada_por_teto | erro_de_infra",
  "perguntas_do_modelo": [],
  "incidentes": []
}
```

### 3.2 `vereditos/<codigo>.json` — one per blind output

```json
{
  "codigo_cego": "PREENCHER",
  "tarefa_zero": "z-02",
  "julgado_em": "2026-09-03",
  "julgado_por": "humano-cego | modelo-cruzado",
  "criterio_aceite": [
    {"n": 1, "texto": "caixa.py continua expondo total(itens, cupom=None).", "resposta": "sim"},
    {"n": 2, "texto": "total([(5000, 2)]) devolve 9000.", "resposta": "sim"}
  ],
  "aprovada": true,
  "rubrica": {"eixo_1": 2, "eixo_2": 1, "eixo_3": 2, "total": 5},
  "observacao_livre": "",
  "juiz": {
    "modelo": "PREENCHER",
    "versao_servida": "PREENCHER",
    "prompt_versao": "juiz-v1",
    "prompt_sha256": "PREENCHER",
    "prompt_integral": "PREENCHER"
  }
}
```

### 3.3 Tracking spreadsheet (the 40 rows)

One row per run. Columns, in this order:

```
rodada_id | tarefa_zero | tarefa_bateria | categoria | complexidade | modelo |
faixa | canal | braco | ordem_na_dupla | sessao_limpa | skills_instaladas |
skills_que_dispararam | turnos_usados | teto_turnos | reprompts |
verificador_codigo_saida | desfecho | codigo_cego | aprovada | rubrica_total |
tokens_entrada | tokens_saida | custo_usd | duracao_s | incidentes
```

Export as CSV. `codigo_cego` and `aprovada` are only filled in **after** step
5.4 — while judging is underway, those two columns stay empty in the spreadsheet and the
file isn't opened during judging.

**The number that matters in the end** isn't "how many approved." It's, by
model tier: `aprovadas(B) − aprovadas(A)`, and the **cost per completed task** in each
arm. A skill can make the call more expensive and the task cheaper, by killing
reprompts. That's the metric nobody publishes.

---

## 4. What can NEVER happen

Every item below, if it happens, **contaminates the batch**. The rule is the same
for all of them: stop, log the incident, and redo whatever needs it — never "keep
going and mention it later."

**Contamination**
1. Reusing a session, tab, context, or history between two runs.
2. Running arm B right after A in the same window, without closing the client.
3. Pasting the statement with any word added or missing.
4. Answering a model's question with information that isn't in the statement or the
   inputs.
5. Helping during the run: correcting, pointing out an error, suggesting a path.
6. Leaving a skill installed in arm A, or a skill outside `skills_candidatas` in
   arm B.
7. Different inputs between A and B of the same pair (check `INSUMOS.sha256`).
8. Running the same pair on days with different versions of the same model, without
   recording it.

**Visible label**
9. Judging while knowing which arm, which model, or which order produced the output.
10. Naming a judging folder, file, or tab with arm, model, or "with/without."
11. Opening `mapa.tsv` — or the tracking spreadsheet — before the last verdict.
12. Letting the output give itself away in the blind copy without going through the
    4.1 scan.
13. Judging both outputs of the same pair back to back: the shuffling exists to
    prevent this.

**Moving the ruler midway**
14. Editing the statement, input, acceptance criterion, or verifier after the
    series' first run.
15. Changing the seed, the plan, or the randomized order after they've been
    published.
16. Adding or removing a task mid-batch.
17. Changing the judge's prompt during the judging of the 40.
18. Reopening a verdict after the map has been revealed.

**Publication**
19. Publishing a number without publishing the raw data behind it.
20. Publishing a discarded run as if it never existed: discards get published too,
    with the reason written down.
21. Publishing a result without channel, battery version, and judge version.

---

## 5. Causal holdout

A skill that shows up alongside a good result shows correlation. To measure
**causation**, someone needs to not receive the skill, without that depending on who
the user is. That's the control group.

**How it works.** On **5% of turns**, chosen by random draw at the moment of the
turn, the router **stays silent on purpose**: it doesn't propose any skill, even with a
clear match. The turn is marked `holdout: true` in the event and enters the dataset as
a control.

**Conditions, all mandatory:**

1. **Declared right to the user's face.** One sentence on first run, not hidden
   in documentation: *"On 5% of turns Batuta stays quiet on purpose, to measure
   whether the skill actually helps. That's what makes the number honest. You can
   change the percentage or turn it off in `~/.batuta/config.json`."*
2. **Configurable.** `holdout_pct` accepts any value from 0 to 100.
3. **Can be turned off.** `holdout_pct = 0` turns it off, and turning it off degrades
   nothing besides the holdout itself.
4. **Marked in the data.** Every holdout turn gets uploaded marked as such. A
   holdout turn that isn't marked is corrupted data.
5. **Never silent.** A hidden experiment destroys the project — it's item 1 of the
   declared risks. If the disclosure doesn't fit in the interface, the holdout doesn't run.

**Configuration:**

```json
{
  "holdout_pct": 5,
  "holdout_semente": "por-instalacao, gerada localmente",
  "holdout_declarado_em": "primeira execucao"
}
```

**In Batuta Zero, the holdout stays off** (`manifesto.json`, field
`holdout_causal`). Zero is already a controlled experiment by construction: the two
arms are the control. The holdout exists for the fleet, where there's no way to ask
each user to run the task twice.

**How to read the number.** Within the same install, same usage profile, and same
time window, the outcome of `holdout: true` turns is compared against the outcome of
turns where the router spoke up. The difference is attributable to routing, not to the
type of user — which is exactly what a between-user comparison can't tell you.

---

## 6. Pocket checklist

Before each run:

- [ ] `sha256sum -c tarefas/CHECKSUMS.txt` passed
- [ ] next line of `plano.tsv`, no skipping
- [ ] run directory recreated from scratch
- [ ] inputs generated with checksum matching the other arm
- [ ] client closed and reopened; new session
- [ ] skills checked with `ls`, not assumed
- [ ] statement pasted without one extra word

Before judging:

- [ ] 40 runs closed out, with `meta.json` filled in
- [ ] self-disclosure scan run and logged
- [ ] `mapa.sha256` committed and the map out of the working folder
- [ ] `ordem_julgamento.txt` generated from the seed
- [ ] tracking spreadsheet closed out

Before publishing:

- [ ] `sha256sum -c mapa.sha256` checks out
- [ ] complete raw data: statement + both outputs + verdict, for the 20 pairs
- [ ] discards published with reason
- [ ] judge's full prompt alongside every verdict
- [ ] channel, battery version, and judge version on every row
- [ ] hash chained to the previous publication and OpenTimestamps stamp

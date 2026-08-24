# registros/ — the hash chain

This folder is Batuta's registry office. Every file here is a published result, and
each one carries the hash of the previous one. If someone — us included — goes back and
changes a number in an old record, every record from that point on stops
balancing the books, and anyone can see it in three seconds.

This isn't cryptographic showmanship. Batuta has only one product, and it's credibility: a
hallucinated number or a silently edited record kills the whole project. The hash chain
exists so that you don't have to take our word for it.

## What's here

```
registros/
  000001-resultado.json     one link
  000002-juiz.json          the next one
  ...
  TOPO.txt                  the hash of the last link, alone, on one line
  TOPO.txt.ots              the OpenTimestamps timestamp over TOPO.txt
```

Every file has this shape:

```json
{
  "tipo": "resultado",
  "corpo": { "...": "the published content, including tipo and criado_em" },
  "hash_anterior": "hash of the previous record (null on the first one)",
  "hash": "sha256 of this link",
  "criado_em": "2026-08-24T02:19:58Z"
}
```

`tipo` and `criado_em` appear twice on purpose: outside, so the file is
readable at a glance; inside `corpo`, which is what's sealed. If the two
copies diverge, verification flags it — you can't backdate a record's
date without breaking the hash.

## How you verify this yourself

Without installing anything besides Node (verification can't have an owner):

```sh
git clone <batuta repo> && cd batuta
node script/cadeia.mjs verificar
```

The output is one of two things. Either:

```
corrente inteira: 128 registro(s), nenhum elo quebrado.
topo: ff50bf42b766207112023550ddbe250fcc51214851134ec9121da90aa0e9703d
```

Or the exact place where it broke, with the declared hash, the recalculated one, and what to do
to find out when it changed:

```
QUEBROU em 000041-resultado.json (posicao 41 de 128)
  hash declarado:   be7e6164...
  hash recalculado: 3e7b89bb...
  o CONTEUDO deste registro foi alterado depois de publicado.
  compare com o git: git log --follow -p registros/000041-resultado.json
```

### If you don't trust our script

Fair — it's our script. The hash recipe fits in one sentence, and you can reimplement it in
any language in twenty minutes:

> `hash = sha256( canonical JSON of {"corpo": <the body>, "hash_anterior": <previous hash, or 64 zeros on the first one>} )`

Canonical JSON means: object keys in code point order, no whitespace
between tokens, integers written without a decimal point, non-integers rounded to 6 decimal places,
escapes only for `"`, `\`, newline, carriage return, tab, and control characters below
0x20 (in `\u00XX` form). It's the same rule in three independent implementations:
`crates/batuta/src/json.rs` (Rust), `script/cadeia.mjs` (Node), and
`portal/lib/cadeia.ts` (portal). They don't reference one another: if they diverge,
they diverge right in front of you.

## The three anchors (and why there are three)

**1. The chain, here.** Proves linkage: no record was altered after
having a successor. On its own it has an obvious hole — whoever controls the folder can
recompute the whole chain from scratch and rewrite history end to end.

**2. The git history, public.** Plugs that hole. Rewriting the whole chain
requires a `push --force` that shows up in the repository, and it doesn't erase the clones other
people already have, nor the mirrors kept by anyone watching. That's why the project rule is
`git commit && git push` in the same motion as appending the record: a record that
exists only on the machine that recorded it is not a published record.

**3. OpenTimestamps, beyond our reach.** Plugs the remaining hole: the dates.
Git is easy to forge on dates (`GIT_AUTHOR_DATE` does whatever you tell it). 
OpenTimestamps stamps `TOPO.txt` on the Bitcoin network, for free, and not even we
can move that date afterward. It's the difference between "they say they measured in August" and
"this hash provably existed in August."

```sh
node script/cadeia.mjs ots        # prints the commands and what the stamp proves
ots verify registros/TOPO.txt.ots # check the stamp yourself
```

## What the chain does NOT prove

This matters more than everything above, and it's written here so no one
can later say we implied otherwise:

- **It does not prove the number is correct.** It proves it wasn't edited after
  publication. A methodological error, a badly written task, a biased judge — all of that
  enters the chain and stays there, sealed, wrong, and immutable. What counters that is other
  things: a frozen battery, holdout, a blind and versioned judge, and the raw data published alongside
  so you can redo the math.
- **It does not prove the measurement happened as described.** It proves the description didn't change.
- **It does not prove there's no drawer full of hidden results.** It proves what was stamped; it says nothing about
  a bad result that was never appended. The antidote for that isn't
  cryptography, it's the protocol: a round declared before it runs, and a bad result
  published just the same.
- **It does not prevent an error from being corrected.** It prevents it from being corrected silently.
  A correction is a new record, of type `correcao`, pointing at the hash of the wrong one. Both
  stay visible forever — that was the deal.

## Appending a record

```sh
node script/cadeia.mjs anexar caminho/do/resultado.json
git add registros/ && git commit -m "registro 000129-resultado" && git push
node script/cadeia.mjs ots     # and stamp the new top
```

The chain only moves forward. There is no editing, there is no deleting, and the portal's
database refuses both too (`sql/002_cadeia.sql`) — but the database is a read
copy. The source of truth is this folder, git, and the timestamp.

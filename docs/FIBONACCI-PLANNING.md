# Fibonacci planning contract

Batuta, LAB and Lumaro use one planning scale: `1, 2, 3, 5, 8, 13`.

This is an estimate made **before** work starts. It never replaces measured
duration, cost, attempts, tokens, tests or outcomes.

| Points | Meaning |
|---:|---|
| 1 | Minimal, isolated change |
| 2 | Small, known change |
| 3 | Simple work with a few risks |
| 5 | Medium work requiring tests and review |
| 8 | Large work with several parts or an integration boundary |
| 13 | Too large to execute as one unit; split it first |

Historical records remain `null` when no estimate was recorded at the time.
Batuta battery v1 stays frozen and unchanged. New batteries and new planning
records use [`planning-fibonacci.schema.json`](../schema/planning-fibonacci.schema.json).

The comparison that matters is estimate versus measured reality. Backfilling a
score after seeing the result would contaminate that comparison.

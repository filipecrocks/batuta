import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeRankingRow, skillRanking } from "./db.ts";

test("normalizes Neon int8 and numeric strings at the database boundary", () => {
  const row = normalizeRankingRow({
    skill: "xlsx",
    routes: "5",
    activations: "0",
    user_activations: "0",
    turns_judged: "2",
    turns_ok: "1",
    reprompts: "0",
    errors: "0",
    retries: "0",
    cost_usd: "0.25",
    trigger_rate: "0",
    ok_rate: "0.5",
    cost_per_task: "0.25",
    median_turns_to_completion: null,
    installations: "3",
    days: 1,
  });
  assert.equal(row.routes, 5);
  assert.equal(row.activations, 0);
  assert.equal(row.activations === 0, true);
  assert.equal(row.ok_rate, 0.5);
});

test("rejects database integers beyond JavaScript's exact range", () => {
  assert.throws(
    () => normalizeRankingRow({ skill: "xlsx", routes: "9007199254740992" }),
    /unsafe routes/,
  );
});

test("ranking validates its window and uses exactly N UTC calendar dates", async () => {
  await assert.rejects(skillRanking({ days: 0 }), /days must be an integer between 1 and 366/);
  const source = await readFile(new URL("./db.ts", import.meta.url), "utf8");
  assert.equal(
    source.match(/> \(now\(\) at time zone 'UTC'\)::date - \$\{days\}::int/g)?.length,
    2,
  );
  assert.doesNotMatch(source, /day >= current_date|date >= current_date/);
});

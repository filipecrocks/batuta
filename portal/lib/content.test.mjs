import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

for (const schema of [
  "daily-summary.schema.json",
  "daily-summary.v2.schema.json",
  "event.schema.json",
  "lab-event.v1.schema.json",
]) {
  test(`published ${schema} matches its canonical source`, async () => {
    const canonical = await readFile(new URL(`schema/${schema}`, root), "utf8");
    const published = await readFile(new URL(`portal/public/schema/${schema}`, root), "utf8");
    assert.equal(published, canonical);
  });
}

test("arena form does not collect the removed contact field", async () => {
  const source = await readFile(new URL("portal/components/FormularioArena.tsx", root), "utf8");
  assert.doesNotMatch(source, /contato|e-mail|autocomplete=["']email/i);
});

test("deprecated daily v1 schema mirrors runtime ingest bounds", async () => {
  const schema = JSON.parse(await readFile(new URL("schema/daily-summary.schema.json", root), "utf8"));
  assert.equal(schema.properties.batuta_version.maxLength, 100);
  assert.equal(schema.properties.mode.maxLength, 50);
  assert.equal(schema.properties.declared_bias.maxLength, 500);
  assert.equal(schema.properties.skills.maxItems, 1000);
  assert.equal(schema.$defs.count.maximum, 1_000_000_000);
  assert.equal(schema.$defs.skill.properties.tokens_in.maximum, 1_000_000_000_000);
  assert.equal(schema.$defs.skill.properties.cost_usd.maximum, 1_000_000);
  assert.equal(schema.$defs.skill.properties.median_turns_to_completion.maximum, 1_000_000);
  assert.equal(schema.$defs.skill.properties.skill.pattern, "^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$");
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contractUrl = new URL("./planning-fibonacci.schema.json", import.meta.url);

async function contract() {
  return JSON.parse(await readFile(contractUrl, "utf8"));
}

test("accepts only the shared planning scale", async () => {
  const schema = await contract();
  assert.deepEqual(schema.properties.planning_points.oneOf[0].enum, [1, 2, 3, 5, 8, 13]);
});

test("keeps historical records explicitly unknown", async () => {
  const schema = await contract();
  assert.equal(schema.properties.planning_points.oneOf[1].type, "null");
  assert.equal(schema.properties.planning_points.default, null);
});

test("requires work at 13 points to be split before execution", async () => {
  const schema = await contract();
  assert.equal(schema.$defs.execution_gate.if.properties.planning_points.const, 13);
  assert.equal(schema.$defs.execution_gate.then.properties.must_split.const, true);
});

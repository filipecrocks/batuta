import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalReceiptMessage,
  findForbiddenKey,
  readLimitedUtf8Body,
  validateLabEvent,
  validateDailySummary,
  verifyReceipt,
  verifySignedRequest,
} from "./ingest.ts";

test("stops reading chunked request bodies at the byte limit", async () => {
  const request = new Request("https://batuta.test/ingest", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    }),
    duplex: "half",
  });
  assert.deepEqual(await readLimitedUtf8Body(request, 10), {
    ok: false,
    error: "body too large",
    status: 413,
  });
});

function baseEvent(overrides = {}) {
  return {
    schema: "batuta.lab_event.v1",
    event_id: "018f47a0-1111-7111-8111-111111111111",
    run_id: "run-2026-08-24-001",
    project: "lumaro",
    order: 7,
    tool: "codex",
    model: "gpt-5.6-sol",
    skill: "test-driven-development",
    cost: { amount: 0.042, currency: "USD" },
    outcome: {
      status: "passed",
      authority: "independent_judge",
      judge: {
        model: "judge-model-v2",
        version: "2026-08-24",
        criteria_hash: "a".repeat(64),
      },
    },
    receipt: {
      issuer: "lab-runner",
      key_id: "lab-key-1",
      algorithm: "ed25519",
      signed_at: "2026-08-24T05:00:00Z",
      evidence_hash: "b".repeat(64),
      signature: `${"A".repeat(86)}==`,
    },
    ...overrides,
  };
}

async function keyFixture() {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicKeys: JSON.stringify({ "lab-key-1": Buffer.from(spki).toString("base64") }),
  };
}

async function sign(privateKey, value) {
  const signature = await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    new TextEncoder().encode(value),
  );
  return Buffer.from(signature).toString("base64");
}

test("rejects prompt-like and secret-bearing keys at any depth", () => {
  assert.equal(findForbiddenKey({ safe: [{ nested: { prompt: "do not store" } }] }), "$.safe[0].nested.prompt");
  assert.equal(findForbiddenKey({ receipt: { authorization: "Bearer secret" } }), "$.receipt.authorization");
  assert.equal(findForbiddenKey(baseEvent()), null);
});

test("rejects a self-judged passed outcome", () => {
  const event = baseEvent({
    outcome: {
      status: "passed",
      authority: "independent_judge",
      judge: {
        model: "gpt-5.6-sol",
        version: "2026-08-24",
        criteria_hash: "a".repeat(64),
      },
    },
  });
  assert.match(validateLabEvent(event).join("\n"), /judge model must differ/i);
});

test("accepts the minimal private LAB event contract", () => {
  assert.deepEqual(validateLabEvent(baseEvent()), []);
  const missingSkill = baseEvent();
  delete missingSkill.skill;
  assert.match(validateLabEvent(missingSkill).join("\n"), /missing required fields: skill/);
});

test("accepts the English daily summary and rejects inconsistent counts", () => {
  const summary = {
    schema: "batuta.daily_summary.v2",
    date: "2026-08-24",
    installation_id: "0123456789abcdef",
    batuta_version: "0.2.0",
    mode: "hook",
    routes: 3,
    routes_with_suggestions: 2,
    holdout_routes: 1,
    treatment_arm: { passed: 0, total: 0 },
    holdout_arm: { passed: 0, total: 0 },
    declared_bias: "voluntary sample",
    measurement_disclaimer: "observational telemetry, not delivery proof",
    skills: [],
  };
  assert.deepEqual(validateDailySummary(summary).errors, []);
  summary.routes_with_suggestions = 4;
  assert.match(validateDailySummary(summary).errors.join("\n"), /cannot exceed routes/);
  summary.routes_with_suggestions = 2;
  summary.date = "2026-02-31";
  assert.match(validateDailySummary(summary).errors.join("\n"), /existing UTC date/);
  summary.date = "2026-08-24";
  summary.treatment_arm = { passed: 1, total: 1 };
  assert.match(validateDailySummary(summary).errors.join("\n"), /only verified LAB receipts/i);
});

test("verifies a detached runner receipt over evidence and verdict", async () => {
  const keys = await keyFixture();
  const event = baseEvent();
  event.receipt.signature = await sign(keys.privateKey, canonicalReceiptMessage(event));
  assert.equal(await verifyReceipt(event, keys.publicKeys), true);
  event.cost.amount = 99;
  assert.equal(await verifyReceipt(event, keys.publicKeys), false);
});

test("authenticates the exact request body and rejects tampering or stale timestamps", async () => {
  const keys = await keyFixture();
  const rawBody = JSON.stringify(baseEvent());
  const timestamp = 1_787_550_000;
  const idempotencyKey = "lab:run-001:order-7";
  const bodyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody));
  const bodyHashHex = Buffer.from(bodyHash).toString("hex");
  const message = `batuta-request-v1\n${timestamp}\n${idempotencyKey}\n${bodyHashHex}`;
  const signature = await sign(keys.privateKey, message);
  const headers = new Headers({
    "x-batuta-key-id": "lab-key-1",
    "x-batuta-timestamp": String(timestamp),
    "idempotency-key": idempotencyKey,
    "x-batuta-signature": signature,
  });

  assert.equal(
    (await verifySignedRequest(rawBody, headers, keys.publicKeys, timestamp * 1000)).ok,
    true,
  );
  assert.equal(
    (await verifySignedRequest(rawBody + " ", headers, keys.publicKeys, timestamp * 1000)).ok,
    false,
  );
  assert.match(
    (await verifySignedRequest(rawBody, headers, keys.publicKeys, (timestamp + 301) * 1000)).error,
    /timestamp/i,
  );
});

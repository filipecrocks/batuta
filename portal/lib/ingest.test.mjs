import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJudgeMessage,
  canonicalReceiptMessage,
  findForbiddenKey,
  readLimitedUtf8Body,
  validateLabEvent,
  validateDailySummary,
  verifyReceipt,
  verifyJudgeAttestation,
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
    routing: { arm: "treatment", holdout_declared: true },
    cost: { amount: 0.042, currency: "USD" },
    outcome: {
      status: "passed",
      authority: "independent_judge",
      judge: {
        model: "judge-model-v2",
        version: "2026-08-24",
        criteria_hash: "a".repeat(64),
        attestation: {
          issuer: "independent-judge-service",
          key_id: "judge-key-1",
          algorithm: "ed25519",
          signed_at: "2026-08-24T04:59:00Z",
          signature: Buffer.alloc(64, 3).toString("base64"),
        },
      },
    },
    receipt: {
      issuer: "lab-runner",
      key_id: "lab-key-1",
      algorithm: "ed25519",
      signed_at: "2026-08-24T05:00:00Z",
      evidence_hash: "b".repeat(64),
      signature: Buffer.alloc(64, 1).toString("base64"),
    },
    ...overrides,
  };
}

async function keyFixture(keyId = "lab-key-1") {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicKeys: JSON.stringify({ [keyId]: Buffer.from(spki).toString("base64") }),
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
        attestation: baseEvent().outcome.judge.attestation,
      },
    },
  });
  assert.match(validateLabEvent(event).join("\n"), /judge model must differ/i);
});

test("rejects a passed outcome without a separately signed judge attestation", () => {
  const event = baseEvent();
  delete event.outcome.judge.attestation;
  assert.match(validateLabEvent(event).join("\n"), /attestation/i);
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

test("accepts the bounded deprecated English v1 daily contract", () => {
  const summary = {
    schema: "batuta.daily_summary.v1",
    day: "2026-08-24",
    installation: "0123456789abcdef",
    batuta_version: "0.1.0",
    mode: "local",
    routes: 1,
    routes_suggested: 1,
    routes_holdout: 0,
    suggested_arm: { ok: 0, n: 0 },
    holdout_arm: { ok: 0, n: 0 },
    declared_bias: "voluntary sample",
    skills: [{
      skill: "xlsx", version: "1", routes: 1, activations: 1,
      user_activations: 0, turns_judged: 0, turns_ok: 0,
      reprompts: 0, errors: 0, retries: 0, tokens_in: 0, tokens_out: 0,
      cost_usd: 0, median_turns_to_completion: 0, ghost: false,
    }],
  };
  assert.deepEqual(validateDailySummary(summary).errors, []);
});

test("bounds daily aggregate cardinality, money, tokens, and per-skill coherence", () => {
  const base = {
    schema: "batuta.daily_summary.v2",
    date: "2026-08-24",
    installation_id: "0123456789abcdef",
    batuta_version: "0.2.0",
    mode: "hook",
    routes: 1,
    routes_with_suggestions: 1,
    holdout_routes: 0,
    treatment_arm: { passed: 0, total: 0 },
    holdout_arm: { passed: 0, total: 0 },
    declared_bias: "voluntary sample",
    measurement_disclaimer: "observability only",
    skills: [{
      skill: "xlsx", version: "1", routes: 1, activations: 1,
      user_activations: 0, judged_turns: 0, successful_turns: 0,
      reprompts: 0, errors: 0, retries: 0, tokens_in: 0, tokens_out: 0,
      cost_usd: 0, median_turns_to_finish: 0, ghost: false,
    }],
  };
  assert.deepEqual(validateDailySummary(base).errors, []);
  for (const [field, value, expected] of [
    ["cost_usd", 1_000_001, /cost_usd.*between/i],
    ["tokens_in", 1_000_000_000_001, /tokens_in.*between/i],
    ["activations", 2, /activations cannot exceed routes/i],
  ]) {
    const candidate = structuredClone(base);
    candidate.skills[0][field] = value;
    assert.match(validateDailySummary(candidate).errors.join("\n"), expected);
  }
  const tooMany = structuredClone(base);
  tooMany.skills = Array.from({ length: 1001 }, (_, index) => ({
    ...base.skills[0],
    skill: `skill-${index}`,
  }));
  assert.match(validateDailySummary(tooMany).errors.join("\n"), /at most 1000/i);
});

test("verifies a detached runner receipt over evidence and verdict", async () => {
  const keys = await keyFixture();
  const event = baseEvent();
  event.receipt.signature = await sign(keys.privateKey, canonicalReceiptMessage(event));
  assert.equal(await verifyReceipt(event, keys.publicKeys), true);
  event.cost.amount = 99;
  assert.equal(await verifyReceipt(event, keys.publicKeys), false);
});

test("requires a cryptographically separate judge key for passed or failed", async () => {
  const runner = await keyFixture("lab-key-1");
  const judge = await keyFixture("judge-key-1");
  const event = baseEvent();
  event.outcome.judge.attestation.signature = await sign(
    judge.privateKey,
    canonicalJudgeMessage(event),
  );
  assert.equal(
    await verifyJudgeAttestation(event, judge.publicKeys, runner.publicKeys),
    true,
  );

  event.outcome.judge.attestation.signature = await sign(
    runner.privateKey,
    canonicalJudgeMessage(event),
  );
  assert.equal(
    await verifyJudgeAttestation(event, runner.publicKeys.replaceAll("lab-key-1", "judge-key-1"), runner.publicKeys),
    false,
  );
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

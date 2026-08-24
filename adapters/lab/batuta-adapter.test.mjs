import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { canonicalJudgeMessage, prepareEvent, signedRequest } from "./batuta-adapter.mjs";

function fixture() {
  const pair = generateKeyPairSync("ed25519");
  const directory = mkdtempSync(join(tmpdir(), "batuta-lab-adapter-"));
  const privateKeyPath = join(directory, "runner-key.pem");
  writeFileSync(
    privateKeyPath,
    pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );
  return { pair, privateKeyPath };
}

const input = {
  run_id: "lab-run-001",
  project: "lumaro",
  order: 1,
  tool: "codex",
  model: "gpt-5.6-sol",
  skill: "test-driven-development",
  routing: { arm: "treatment", holdout_declared: true },
  cost: { amount: 0.01, currency: "USD" },
  outcome: { status: "unknown", authority: "runtime_observation" },
  evidence_hash: "a".repeat(64),
};

test("prepares a privacy-minimized UUIDv7 event with a runner signature", async () => {
  const { pair, privateKeyPath } = fixture();
  const event = await prepareEvent(input, {
    issuer: "lab-runner",
    keyId: "lab-key-1",
    privateKeyPath,
  });
  assert.match(event.event_id, /^[0-9a-f-]{14}7[0-9a-f]{3}-[89ab][0-9a-f]{3}-/);
  assert.equal(event.receipt.algorithm, "ed25519");
  assert.equal("evidence_hash" in event, false);
  assert.equal("prompt" in event, false);

  const publicKeys = JSON.stringify({
    "lab-key-1": pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  });
  const { verifyReceipt } = await import("../../portal/lib/ingest.ts");
  assert.equal(await verifyReceipt(event, publicKeys), true);
});

test("refuses prompt or credential material before signing", async () => {
  const { privateKeyPath } = fixture();
  await assert.rejects(
    prepareEvent({ ...input, prompt: "private" }, {
      issuer: "lab-runner",
      keyId: "lab-key-1",
      privateKeyPath,
    }),
    /forbidden/i,
  );
});

test("refuses a self-judged verdict before signing", async () => {
  const { privateKeyPath } = fixture();
  await assert.rejects(
    prepareEvent({
      ...input,
      outcome: {
        status: "passed",
        authority: "independent_judge",
        judge: { model: input.model, version: "judge-v1", criteria_hash: "b".repeat(64) },
      },
    }, {
      issuer: "lab-runner",
      keyId: "lab-key-1",
      privateKeyPath,
    }),
    /judge model must differ/i,
  );
});

test("refuses an unsigned verdict that merely names a different model", async () => {
  const { privateKeyPath } = fixture();
  await assert.rejects(
    prepareEvent({
      ...input,
      event_id: "018f47a0-1111-7111-8111-111111111111",
      outcome: {
        status: "passed",
        authority: "independent_judge",
        judge: { model: "judge-model", version: "judge-v1", criteria_hash: "b".repeat(64) },
      },
    }, {
      issuer: "lab-runner",
      keyId: "lab-key-1",
      privateKeyPath,
      judgePublicKeys: "{}",
    }),
    /attestation/i,
  );
});

test("accepts a verdict only after a separate configured judge signs it", async () => {
  const runner = fixture();
  const judge = fixture();
  const judged = {
    ...input,
    event_id: "018f47a0-1111-7111-8111-111111111111",
    signed_at: "2026-08-24T05:00:00Z",
    outcome: {
      status: "passed",
      authority: "independent_judge",
      judge: {
        model: "judge-model",
        version: "judge-v1",
        criteria_hash: "b".repeat(64),
        attestation: {
          issuer: "judge-service",
          key_id: "judge-key-1",
          algorithm: "ed25519",
          signed_at: "2026-08-24T04:59:00Z",
          signature: "",
        },
      },
    },
  };
  judged.outcome.judge.attestation.signature = sign(
    null,
    Buffer.from(canonicalJudgeMessage({
      ...judged,
      receipt: { evidence_hash: judged.evidence_hash },
    }), "utf8"),
    judge.pair.privateKey,
  ).toString("base64");
  const judgePublicKeys = JSON.stringify({
    "judge-key-1": judge.pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  });
  const event = await prepareEvent(judged, {
    issuer: "lab-runner",
    keyId: "lab-key-1",
    privateKeyPath: runner.privateKeyPath,
    judgePublicKeys,
  });
  assert.equal(event.outcome.status, "passed");

  const cli = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./batuta-adapter.mjs", import.meta.url)),
      "prepare",
      "--key-id", "lab-key-1",
      "--private-key", runner.privateKeyPath,
    ],
    {
      input: JSON.stringify(judged),
      encoding: "utf8",
      env: { ...process.env, BATUTA_JUDGE_PUBLIC_KEYS: judgePublicKeys },
    },
  );
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).outcome.status, "passed");
});

test("signs a stable idempotent request around the prepared body", async () => {
  const { pair, privateKeyPath } = fixture();
  const event = await prepareEvent(input, {
    issuer: "lab-runner",
    keyId: "lab-key-1",
    privateKeyPath,
  });
  const signed = await signedRequest(event, {
    keyId: "lab-key-1",
    privateKeyPath,
    timestamp: 1_787_550_000,
  });
  assert.equal(signed.headers["idempotency-key"], `lab:${event.event_id}`);
  const publicKeys = JSON.stringify({
    "lab-key-1": pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  });
  const { verifySignedRequest } = await import("../../portal/lib/ingest.ts");
  assert.equal(
    (
      await verifySignedRequest(
        signed.body,
        new Headers(signed.headers),
        publicKeys,
        1_787_550_000_000,
      )
    ).ok,
    true,
  );
});

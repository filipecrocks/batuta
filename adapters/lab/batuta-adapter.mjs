#!/usr/bin/env node
/**
 * Reference LAB adapter. It prepares one signed, privacy-minimized event per
 * processing unit and sends an already-prepared event with a stable idempotency
 * key. The caller persists the prepared JSON before sending so retries keep the
 * same event_id, receipt, and body.
 */
import {
  createHash,
  createPrivateKey,
  randomBytes,
  sign,
} from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_KEYS = new Set([
  "prompt", "prompt_hash", "user_prompt", "system_prompt", "messages", "response", "transcript",
  "secret", "secrets", "password", "token", "access_token", "api_key", "private_key",
  "authorization", "cookie", "environment", "env", "path", "session_id",
]);

function assertPrivateKeyFile(path) {
  const metadata = statSync(path);
  if (!metadata.isFile()) throw new Error("private key path is not a file");
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error("private key file must be owner-only (chmod 600)");
  }
}

function loadPrivateKey(path) {
  assertPrivateKeyFile(path);
  return createPrivateKey(readFileSync(path));
}

function findForbiddenKey(value, path = "$", depth = 0) {
  if (depth > 32) return `${path} (maximum nesting exceeded)`;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = findForbiddenKey(value[index], `${path}[${index}]`, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) return `${path}.${key}`;
    const found = findForbiddenKey(child, `${path}.${key}`, depth + 1);
    if (found) return found;
  }
  return null;
}

function uuidV7(now = Date.now()) {
  const bytes = randomBytes(16);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index--) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertId(value, name) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error(`${name} contains characters outside the identifier allowlist`);
  }
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("input must be an object");
  const forbidden = findForbiddenKey(input);
  if (forbidden) throw new Error(`forbidden private key at ${forbidden}`);
  const allowed = new Set([
    "event_id", "signed_at", "run_id", "project", "order", "tool", "model",
    "skill", "cost", "outcome", "evidence_hash",
  ]);
  const extras = Object.keys(input).filter((key) => !allowed.has(key));
  if (extras.length) throw new Error(`unknown input fields: ${extras.join(", ")}`);
  if (input.event_id !== undefined && !UUID_V7.test(input.event_id)) throw new Error("event_id must be a UUIDv7");
  if (
    input.signed_at !== undefined &&
    (typeof input.signed_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.signed_at) ||
      !Number.isFinite(Date.parse(input.signed_at)))
  ) {
    throw new Error("signed_at must be an ISO-8601 timestamp");
  }
  for (const field of ["run_id", "project", "tool", "model"]) assertId(input[field], field);
  if (input.skill !== null && input.skill !== undefined) assertId(input.skill, "skill");
  if (!Number.isSafeInteger(input.order) || input.order < 0) throw new Error("order must be a non-negative safe integer");
  if (!input.cost || typeof input.cost !== "object" || input.cost.currency !== "USD") throw new Error("cost must use USD");
  if (typeof input.cost.amount !== "number" || !Number.isFinite(input.cost.amount) || input.cost.amount < 0 || input.cost.amount > 1_000_000) {
    throw new Error("cost.amount must be a finite number between 0 and 1000000");
  }
  if (!input.outcome || typeof input.outcome !== "object") throw new Error("outcome is required");
  const outcomeExtras = Object.keys(input.outcome).filter((key) => !["status", "authority", "judge"].includes(key));
  if (outcomeExtras.length) throw new Error(`unknown outcome fields: ${outcomeExtras.join(", ")}`);
  if (input.outcome.status === "unknown") {
    if (input.outcome.authority !== "runtime_observation" || input.outcome.judge !== undefined) {
      throw new Error("unknown outcomes require runtime_observation and no judge");
    }
  } else if (input.outcome.status === "passed" || input.outcome.status === "failed") {
    const judge = input.outcome.judge;
    if (input.outcome.authority !== "independent_judge" || !judge || typeof judge !== "object") {
      throw new Error("passed/failed outcomes require an independent judge");
    }
    const judgeExtras = Object.keys(judge).filter((key) => !["model", "version", "criteria_hash"].includes(key));
    if (judgeExtras.length) throw new Error(`unknown judge fields: ${judgeExtras.join(", ")}`);
    assertId(judge.model, "outcome.judge.model");
    assertId(judge.version, "outcome.judge.version");
    if (judge.model === input.model) throw new Error("judge model must differ from subject model");
    if (!HEX_64.test(judge.criteria_hash ?? "")) throw new Error("judge criteria_hash must be 64 lowercase hexadecimal characters");
  } else {
    throw new Error("outcome.status must be passed, failed, or unknown");
  }
  if (!HEX_64.test(input.evidence_hash ?? "")) throw new Error("evidence_hash must be 64 lowercase hexadecimal characters");
}

export function canonicalReceiptMessage(event) {
  return [
    "batuta-receipt-v1",
    event.event_id,
    event.run_id,
    event.project,
    String(event.order),
    event.tool,
    event.model,
    event.skill ?? "-",
    String(event.cost.amount),
    event.cost.currency,
    event.outcome.status,
    event.outcome.authority,
    event.outcome.judge?.model ?? "-",
    event.outcome.judge?.version ?? "-",
    event.outcome.judge?.criteria_hash ?? "-",
    event.receipt.issuer,
    event.receipt.key_id,
    event.receipt.algorithm,
    event.receipt.signed_at,
    event.receipt.evidence_hash,
  ].join("\n");
}

export async function prepareEvent(input, options) {
  validateInput(input);
  assertId(options.issuer, "issuer");
  assertId(options.keyId, "keyId");
  const event = {
    schema: "batuta.lab_event.v1",
    event_id: input.event_id ?? uuidV7(),
    run_id: input.run_id,
    project: input.project,
    order: input.order,
    tool: input.tool,
    model: input.model,
    skill: input.skill ?? null,
    cost: { amount: input.cost.amount, currency: "USD" },
    outcome: input.outcome,
    receipt: {
      issuer: options.issuer,
      key_id: options.keyId,
      algorithm: "ed25519",
      signed_at: input.signed_at ?? new Date().toISOString(),
      evidence_hash: input.evidence_hash,
      signature: "",
    },
  };
  const privateKey = loadPrivateKey(options.privateKeyPath);
  event.receipt.signature = sign(
    null,
    Buffer.from(canonicalReceiptMessage(event), "utf8"),
    privateKey,
  ).toString("base64");
  return event;
}

export async function signedRequest(event, options) {
  assertId(options.keyId, "keyId");
  if (event.receipt?.key_id !== options.keyId) throw new Error("event receipt key does not match request key");
  const body = JSON.stringify(event);
  const requestHash = createHash("sha256").update(body).digest("hex");
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp)) throw new Error("timestamp must be integer epoch seconds");
  const idempotencyKey = `lab:${event.event_id}`;
  const message = `batuta-request-v1\n${timestamp}\n${idempotencyKey}\n${requestHash}`;
  const signature = sign(null, Buffer.from(message, "utf8"), loadPrivateKey(options.privateKeyPath));
  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-batuta-key-id": options.keyId,
      "x-batuta-timestamp": String(timestamp),
      "idempotency-key": idempotencyKey,
      "x-batuta-signature": signature.toString("base64"),
    },
  };
}

export async function sendEvent(event, options) {
  const endpoint = new URL(options.endpoint ?? "https://batuta.space/api/ingest/lab");
  if (endpoint.protocol !== "https:") throw new Error("LAB ingest endpoint must use HTTPS");
  const request = await signedRequest(event, options);
  const fetchImplementation = options.fetch ?? fetch;
  const response = await fetchImplementation(endpoint, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json().catch(() => ({ ok: false, error: "non-JSON response" }));
  if (!response.ok) throw new Error(`Batuta ingest returned HTTP ${response.status}: ${body.error ?? "unknown error"}`);
  return body;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readStdin() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 256 * 1024) throw new Error("stdin exceeds 256 KiB");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body);
}

async function main() {
  const command = process.argv[2];
  const keyId = argument("--key-id");
  const privateKeyPath = argument("--private-key");
  if (!keyId || !privateKeyPath) throw new Error("--key-id and --private-key are required");
  if (command === "prepare") {
    const event = await prepareEvent(await readStdin(), {
      issuer: argument("--issuer") ?? "lab-runner",
      keyId,
      privateKeyPath,
    });
    process.stdout.write(`${JSON.stringify(event)}\n`);
  } else if (command === "send") {
    const eventFile = argument("--event");
    if (!eventFile) throw new Error("send requires --event PATH to a persisted prepared event");
    const event = JSON.parse(readFileSync(eventFile, "utf8"));
    const result = await sendEvent(event, {
      keyId,
      privateKeyPath,
      endpoint: argument("--endpoint"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    throw new Error("usage: batuta-adapter.mjs prepare|send --key-id ID --private-key PATH");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`batuta LAB adapter: ${error.message}\n`);
    process.exitCode = 1;
  });
}

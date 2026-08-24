/** Security boundary shared by the aggregate and LAB ingestion endpoints. */

const HEX_64 = /^[0-9a-f]{64}$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$/;
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{7,159}$/;
const FORBIDDEN_KEYS = new Set([
  "prompt",
  "prompt_hash",
  "user_prompt",
  "system_prompt",
  "messages",
  "response",
  "transcript",
  "secret",
  "secrets",
  "password",
  "token",
  "access_token",
  "api_key",
  "private_key",
  "authorization",
  "cookie",
  "environment",
  "env",
  "path",
  "session_id",
]);

type UnknownRecord = Record<string, unknown>;

export async function readLimitedUtf8Body(
  request: Pick<Request, "body" | "headers">,
  maximumBytes: number,
): Promise<{ ok: true; body: string } | { ok: false; error: string; status: number }> {
  const declaredText = request.headers.get("content-length");
  if (declaredText !== null) {
    if (!/^\d+$/.test(declaredText)) return { ok: false, error: "invalid content-length", status: 400 };
    if (Number(declaredText) > maximumBytes) return { ok: false, error: "body too large", status: 413 };
  }
  if (!request.body) return { ok: true, body: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel("body too large");
        return { ok: false, error: "body too large", status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: "could not read request body", status: 400 };
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, body: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, error: "request body must be valid UTF-8", status: 400 };
  }
}

export type LabEvent = {
  schema: "batuta.lab_event.v1";
  event_id: string;
  run_id: string;
  project: string;
  order: number;
  tool: string;
  model: string;
  skill: string | null;
  cost: { amount: number; currency: "USD" };
  outcome: {
    status: "passed" | "failed" | "unknown";
    authority: "independent_judge" | "runtime_observation";
    judge?: { model: string; version: string; criteria_hash: string };
  };
  receipt: {
    issuer: string;
    key_id: string;
    algorithm: "ed25519";
    signed_at: string;
    evidence_hash: string;
    signature: string;
  };
};

export type NormalizedDailySummary = {
  schema: "batuta.daily_summary.v2" | "batuta.daily_summary.v1" | "batuta.resumo_diario.v1";
  date: string;
  installationId: string;
  batutaVersion: string;
  mode: string;
  skills: unknown[];
};

function record(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: UnknownRecord, allowed: readonly string[], path: string, errors: string[]) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) errors.push(`${path} has unknown fields: ${extras.join(", ")}`);
}

function requiredKeys(value: UnknownRecord, required: readonly string[], path: string, errors: string[]) {
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length) errors.push(`${path} is missing required fields: ${missing.join(", ")}`);
}

function safeText(value: unknown, path: string, errors: string[], maximum = 128): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\u0000-\u001f]/.test(value)) {
    errors.push(`${path} must be non-empty text of at most ${maximum} characters without controls`);
    return false;
  }
  return true;
}

export function findForbiddenKey(value: unknown, path = "$", depth = 0): string | null {
  if (depth > 32) return `${path} (maximum nesting exceeded)`;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = findForbiddenKey(value[index], `${path}[${index}]`, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!record(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) return `${path}.${key}`;
    const found = findForbiddenKey(child, `${path}.${key}`, depth + 1);
    if (found) return found;
  }
  return null;
}

export function validateLabEvent(value: unknown): string[] {
  const errors: string[] = [];
  if (!record(value)) return ["body must be a JSON object"];
  exactKeys(
    value,
    ["schema", "event_id", "run_id", "project", "order", "tool", "model", "skill", "cost", "outcome", "receipt"],
    "$",
    errors,
  );
  requiredKeys(
    value,
    ["schema", "event_id", "run_id", "project", "order", "tool", "model", "skill", "cost", "outcome", "receipt"],
    "$",
    errors,
  );
  if (value.schema !== "batuta.lab_event.v1") errors.push('schema must be "batuta.lab_event.v1"');
  if (typeof value.event_id !== "string" || !UUID_V7.test(value.event_id)) {
    errors.push("event_id must be a UUIDv7");
  }
  for (const field of ["run_id", "project", "tool", "model"] as const) {
    if (safeText(value[field], field, errors) && !SAFE_ID.test(value[field] as string)) {
      errors.push(`${field} contains characters outside the identifier allowlist`);
    }
  }
  if (!Number.isSafeInteger(value.order) || (value.order as number) < 0) {
    errors.push("order must be a non-negative safe integer");
  }
  if (value.skill !== null && value.skill !== undefined) {
    if (safeText(value.skill, "skill", errors) && !SAFE_ID.test(value.skill as string)) {
      errors.push("skill contains characters outside the identifier allowlist");
    }
  }

  if (!record(value.cost)) {
    errors.push("cost must be {amount, currency}");
  } else {
    exactKeys(value.cost, ["amount", "currency"], "cost", errors);
    if (typeof value.cost.amount !== "number" || !Number.isFinite(value.cost.amount) || value.cost.amount < 0 || value.cost.amount > 1_000_000) {
      errors.push("cost.amount must be a finite number between 0 and 1000000");
    }
    if (value.cost.currency !== "USD") errors.push('cost.currency must be "USD"');
  }

  if (!record(value.outcome)) {
    errors.push("outcome must be an object");
  } else {
    exactKeys(value.outcome, ["status", "authority", "judge"], "outcome", errors);
    const status = value.outcome.status;
    if (!matches(status, ["passed", "failed", "unknown"])) {
      errors.push("outcome.status must be passed, failed, or unknown");
    }
    if (status === "passed" || status === "failed") {
      if (value.outcome.authority !== "independent_judge") {
        errors.push("passed/failed outcomes require authority=independent_judge");
      }
      if (!record(value.outcome.judge)) {
        errors.push("passed/failed outcomes require a judge object");
      } else {
        exactKeys(value.outcome.judge, ["model", "version", "criteria_hash"], "outcome.judge", errors);
        if (safeText(value.outcome.judge.model, "outcome.judge.model", errors) && !SAFE_ID.test(value.outcome.judge.model as string)) {
          errors.push("outcome.judge.model contains characters outside the identifier allowlist");
        }
        safeText(value.outcome.judge.version, "outcome.judge.version", errors);
        if (value.outcome.judge.model === value.model) errors.push("judge model must differ from subject model");
        if (typeof value.outcome.judge.criteria_hash !== "string" || !HEX_64.test(value.outcome.judge.criteria_hash)) {
          errors.push("outcome.judge.criteria_hash must be 64 lowercase hexadecimal characters");
        }
      }
    } else {
      if (value.outcome.authority !== "runtime_observation") {
        errors.push("unknown outcomes require authority=runtime_observation");
      }
      if (value.outcome.judge !== undefined) errors.push("unknown outcomes must not include a judge");
    }
  }

  if (!record(value.receipt)) {
    errors.push("receipt must be an object");
  } else {
    exactKeys(
      value.receipt,
      ["issuer", "key_id", "algorithm", "signed_at", "evidence_hash", "signature"],
      "receipt",
      errors,
    );
    if (safeText(value.receipt.issuer, "receipt.issuer", errors) && !SAFE_ID.test(value.receipt.issuer as string)) {
      errors.push("receipt.issuer contains characters outside the identifier allowlist");
    }
    if (safeText(value.receipt.key_id, "receipt.key_id", errors) && !SAFE_ID.test(value.receipt.key_id as string)) {
      errors.push("receipt.key_id contains characters outside the identifier allowlist");
    }
    if (value.receipt.algorithm !== "ed25519") errors.push('receipt.algorithm must be "ed25519"');
    if (
      typeof value.receipt.signed_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.receipt.signed_at) ||
      !Number.isFinite(Date.parse(value.receipt.signed_at))
    ) {
      errors.push("receipt.signed_at must be an ISO-8601 timestamp");
    }
    if (typeof value.receipt.evidence_hash !== "string" || !HEX_64.test(value.receipt.evidence_hash)) {
      errors.push("receipt.evidence_hash must be 64 lowercase hexadecimal characters");
    }
    if (
      typeof value.receipt.signature !== "string" ||
      decodeBase64(value.receipt.signature)?.length !== 64
    ) {
      errors.push("receipt.signature must be a base64 Ed25519 signature");
    }
  }
  return errors;
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nonNegativeNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateDailySummary(value: unknown): {
  errors: string[];
  normalized?: NormalizedDailySummary;
} {
  const errors: string[] = [];
  if (!record(value)) return { errors: ["body must be a JSON object"] };
  const isV2 = value.schema === "batuta.daily_summary.v2";
  const isEnglishV1 = value.schema === "batuta.daily_summary.v1";
  const isPortugueseV1 = value.schema === "batuta.resumo_diario.v1";
  if (!isV2 && !isEnglishV1 && !isPortugueseV1) {
    return { errors: ["unsupported daily summary schema"] };
  }

  const topFields = isV2
    ? [
        "schema", "date", "installation_id", "batuta_version", "mode", "routes",
        "routes_with_suggestions", "holdout_routes", "treatment_arm", "holdout_arm",
        "declared_bias", "measurement_disclaimer", "skills",
      ]
    : isEnglishV1
      ? [
          "schema", "day", "installation", "batuta_version", "mode", "routes",
          "routes_suggested", "routes_holdout", "suggested_arm", "holdout_arm",
          "declared_bias", "skills",
        ]
      : [
        "schema", "dia", "instalacao", "batuta_versao", "modo", "rotas",
        "rotas_com_sugestao", "rotas_holdout", "braco_com", "braco_holdout",
        "vies_declarado", "skills",
      ];
  exactKeys(value, topFields, "$", errors);
  const date = value[isV2 ? "date" : isEnglishV1 ? "day" : "dia"];
  const installationId = value[isV2 ? "installation_id" : isEnglishV1 ? "installation" : "instalacao"];
  const batutaVersion = value[isPortugueseV1 ? "batuta_versao" : "batuta_version"];
  const mode = value[isPortugueseV1 ? "modo" : "mode"];
  const routes = value[isPortugueseV1 ? "rotas" : "routes"];
  const routesWithSuggestions = value[isV2 ? "routes_with_suggestions" : isEnglishV1 ? "routes_suggested" : "rotas_com_sugestao"];
  const holdoutRoutes = value[isV2 ? "holdout_routes" : isEnglishV1 ? "routes_holdout" : "rotas_holdout"];
  const treatment = value[isV2 ? "treatment_arm" : isEnglishV1 ? "suggested_arm" : "braco_com"];
  const holdout = value[isPortugueseV1 ? "braco_holdout" : "holdout_arm"];
  const declaredBias = value[isPortugueseV1 ? "vies_declarado" : "declared_bias"];

  const parsedDate = typeof date === "string" ? new Date(`${date}T00:00:00Z`) : null;
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !parsedDate ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  ) {
    errors.push("date must be an existing UTC date in YYYY-MM-DD form");
  } else if (Date.parse(`${date}T00:00:00Z`) > Date.now() + 36 * 60 * 60 * 1000) {
    errors.push("date is too far in the future");
  }
  if (typeof installationId !== "string" || !/^[0-9a-f]{16}$/.test(installationId)) {
    errors.push("installation_id must be 16 lowercase hexadecimal characters");
  }
  safeText(batutaVersion, "batuta_version", errors, 100);
  safeText(mode, "mode", errors, 50);
  safeText(declaredBias, "declared_bias", errors, 500);
  if (isV2) safeText(value.measurement_disclaimer, "measurement_disclaimer", errors, 500);
  for (const [name, count] of [
    ["routes", routes],
    ["routes_with_suggestions", routesWithSuggestions],
    ["holdout_routes", holdoutRoutes],
  ] as const) {
    if (!nonNegativeInteger(count)) errors.push(`${name} must be a non-negative safe integer`);
  }
  if (nonNegativeInteger(routes) && nonNegativeInteger(routesWithSuggestions) && (routesWithSuggestions as number) > (routes as number)) {
    errors.push("routes_with_suggestions cannot exceed routes");
  }
  if (nonNegativeInteger(routes) && nonNegativeInteger(holdoutRoutes) && (holdoutRoutes as number) > (routes as number)) {
    errors.push("holdout_routes cannot exceed routes");
  }
  for (const [name, arm] of [["treatment_arm", treatment], ["holdout_arm", holdout]] as const) {
    if (!record(arm)) {
      errors.push(`${name} must be an object`);
      continue;
    }
    const passed = arm[isV2 ? "passed" : "ok"];
    const total = arm[isV2 ? "total" : "n"];
    exactKeys(arm, isV2 ? ["passed", "total"] : ["ok", "n"], name, errors);
    if (!nonNegativeInteger(passed) || !nonNegativeInteger(total)) errors.push(`${name} counts must be non-negative safe integers`);
    else if ((passed as number) > (total as number)) errors.push(`${name}.passed cannot exceed total`);
  }

  if (!Array.isArray(value.skills) || value.skills.length > 5000) {
    errors.push("skills must be an array with at most 5000 entries");
  } else {
    const seen = new Set<string>();
    const skillFields = isV2
      ? [
          "skill", "version", "routes", "activations", "user_activations", "judged_turns",
          "successful_turns", "reprompts", "errors", "retries", "tokens_in", "tokens_out",
          "cost_usd", "median_turns_to_finish", "ghost",
        ]
      : isEnglishV1
        ? [
            "skill", "version", "routes", "activations", "user_activations", "turns_judged",
            "turns_ok", "reprompts", "errors", "retries", "tokens_in", "tokens_out",
            "cost_usd", "median_turns_to_completion", "ghost",
          ]
        : [
          "skill", "versao", "rotas", "ativacoes", "ativacoes_usuario", "turnos_julgados",
          "turnos_ok", "reprompts", "erros", "retries", "tokens_in", "tokens_out",
          "custo_usd", "turnos_ate_fim_mediana", "fantasma",
        ];
    value.skills.forEach((skill, index) => {
      if (!record(skill)) {
        errors.push(`skills[${index}] must be an object`);
        return;
      }
      exactKeys(skill, skillFields, `skills[${index}]`, errors);
      const name = skill.skill;
      if (typeof name !== "string" || !SAFE_ID.test(name)) errors.push(`skills[${index}].skill is invalid`);
      else if (seen.has(name)) errors.push(`skills[${index}].skill is duplicated`);
      else seen.add(name);
      const integerFields = isV2
        ? ["routes", "activations", "user_activations", "judged_turns", "successful_turns", "reprompts", "errors", "retries"]
        : isEnglishV1
          ? ["routes", "activations", "user_activations", "turns_judged", "turns_ok", "reprompts", "errors", "retries"]
          : ["rotas", "ativacoes", "ativacoes_usuario", "turnos_julgados", "turnos_ok", "reprompts", "erros", "retries"];
      for (const field of integerFields) {
        if (!nonNegativeInteger(skill[field])) errors.push(`skills[${index}].${field} must be a non-negative safe integer`);
      }
      const numericFields = isV2
        ? ["tokens_in", "tokens_out", "cost_usd", "median_turns_to_finish"]
        : isEnglishV1
          ? ["tokens_in", "tokens_out", "cost_usd", "median_turns_to_completion"]
          : ["tokens_in", "tokens_out", "custo_usd", "turnos_ate_fim_mediana"];
      for (const field of numericFields) {
        if (!nonNegativeNumber(skill[field])) errors.push(`skills[${index}].${field} must be a non-negative finite number`);
      }
      const ghost = skill[isPortugueseV1 ? "fantasma" : "ghost"];
      if (typeof ghost !== "boolean") errors.push(`skills[${index}].ghost must be boolean`);
      const version = skill[isPortugueseV1 ? "versao" : "version"];
      if (typeof version !== "string" || version.length > 100) errors.push(`skills[${index}].version must be text of at most 100 characters`);
    });
  }

  if (errors.length) return { errors };
  return {
    errors,
    normalized: {
      schema: value.schema as NormalizedDailySummary["schema"],
      date: date as string,
      installationId: installationId as string,
      batutaVersion: batutaVersion as string,
      mode: mode as string,
      skills: value.skills as unknown[],
    },
  };
}

function matches(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === "string" && allowed.includes(value);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const buffer = Buffer.from(value, "base64");
    if (buffer.length === 0 || buffer.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) return null;
    // Copy out of Node's pooled Buffer so Web Crypto receives an ArrayBuffer,
    // rather than the broader SharedArrayBuffer-compatible BufferSource type.
    const bytes = new Uint8Array(buffer.length);
    bytes.set(buffer);
    return bytes;
  } catch {
    return null;
  }
}

function parsePublicKeys(serialized: string | undefined): Record<string, string> | null {
  if (!serialized) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!record(parsed)) return null;
    if (Object.keys(parsed).length === 0 || Object.keys(parsed).length > 100) return null;
    if (!Object.entries(parsed).every(([key, value]) => SAFE_ID.test(key) && typeof value === "string")) return null;
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}

async function importPublicKey(keyId: string, serialized: string | undefined): Promise<CryptoKey | null> {
  const keys = parsePublicKeys(serialized);
  const encoded = keys?.[keyId];
  if (!encoded) return null;
  const bytes = decodeBase64(encoded);
  if (!bytes) return null;
  try {
    return await crypto.subtle.importKey("spki", bytes, "Ed25519", false, ["verify"]);
  } catch {
    return null;
  }
}

export function canonicalReceiptMessage(event: LabEvent): string {
  const criteriaHash = event.outcome.judge?.criteria_hash ?? "-";
  return [
    "batuta-receipt-v1",
    event.event_id,
    event.run_id,
    String(event.order),
    event.outcome.status,
    event.receipt.evidence_hash,
    criteriaHash,
  ].join("\n");
}

export async function verifyReceipt(event: LabEvent, publicKeys: string | undefined): Promise<boolean> {
  const key = await importPublicKey(event.receipt.key_id, publicKeys);
  const signature = decodeBase64(event.receipt.signature);
  if (!key || !signature) return false;
  return crypto.subtle.verify(
    "Ed25519",
    key,
    signature,
    new TextEncoder().encode(canonicalReceiptMessage(event)),
  );
}

async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type SignedRequestVerification = {
  ok: boolean;
  error: string;
  keyId?: string;
  idempotencyKey?: string;
  requestHash?: string;
  signature?: string;
  timestamp?: number;
};

export async function verifySignedRequest(
  rawBody: string,
  headers: Pick<Headers, "get">,
  publicKeys: string | undefined,
  nowMs = Date.now(),
): Promise<SignedRequestVerification> {
  const keyId = headers.get("x-batuta-key-id") ?? "";
  const timestampText = headers.get("x-batuta-timestamp") ?? "";
  const idempotencyKey = headers.get("idempotency-key") ?? "";
  const signatureText = headers.get("x-batuta-signature") ?? "";
  if (!SAFE_ID.test(keyId)) return { ok: false, error: "missing or invalid x-batuta-key-id" };
  if (!SAFE_IDEMPOTENCY_KEY.test(idempotencyKey)) return { ok: false, error: "missing or invalid idempotency-key" };
  const timestamp = Number(timestampText);
  if (!/^\d{10}$/.test(timestampText) || !Number.isSafeInteger(timestamp) || Math.abs(nowMs - timestamp * 1000) > 300_000) {
    return { ok: false, error: "x-batuta-timestamp is outside the 5-minute replay window" };
  }
  const key = await importPublicKey(keyId, publicKeys);
  const signature = decodeBase64(signatureText);
  if (!key || !signature) return { ok: false, error: "unknown key or malformed signature" };
  const requestHash = await sha256Hex(rawBody);
  const message = `batuta-request-v1\n${timestamp}\n${idempotencyKey}\n${requestHash}`;
  const verified = await crypto.subtle.verify(
    "Ed25519",
    key,
    signature,
    new TextEncoder().encode(message),
  );
  if (!verified) return { ok: false, error: "request signature verification failed" };
  return {
    ok: true,
    error: "",
    keyId,
    idempotencyKey,
    requestHash,
    signature: signatureText,
    timestamp,
  };
}

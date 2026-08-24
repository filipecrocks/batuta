/**
 * POST /api/ingest — receives ONE aggregated daily summary (schema batuta.daily_summary.v1).
 *
 * This is the only point in the project where user data enters. It's written
 * defensively against OUR OWN client, not against an attacker: if a bug in the
 * binary sends a raw event, the damage is irreversible — a prompt hash in the
 * database is a prompt hash in the backup, in the replica, and in the dump someone
 * downloaded. That's why the forbidden-key sweep happens BEFORE schema validation
 * and rejects the entire body, even if it was formally correct (§1.3, §4.5).
 *
 * What this endpoint deliberately does NOT do: it doesn't set a cookie, doesn't
 * read the IP, doesn't keep the user agent, doesn't return anything that would
 * help correlate two installations.
 */
import { sql, hasDb } from "../../../lib/db";
import { canonical, sha256Hex } from "../../../lib/chain";

// Needs node: the canonical hash and the driver run on both runtimes, but
// ingestion is a write path and we prefer the runtime that gives a full
// stack trace when something breaks at 3am.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 256 KB. A day of heavy use produces a few KB (~20 lines per installation); anyone
 *  sending more than that is sending something else. */
const BYTE_LIMIT = 256 * 1024;

/** If any of these show up at any level, the body is a raw event. */
const FORBIDDEN_KEYS = ["prompt", "prompt_hash", "turn", "text"];

const CORS: Record<string, string> = {
  // The binary runs on the machine of whoever installed it, not on a domain of
  // ours: there's no origin to restrict. What restricts is the method — POST only.
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET() {
  return json(
    {
      ok: false,
      error: "this endpoint only accepts POST",
      format: "https://batuta.space/schema/daily-summary.schema.json",
      hint: "to see what your Batuta would send, run `batuta summary` — it prints the exact body, and nothing leaves the machine while `upload` is off",
    },
    405,
  );
}

// =========================================================== key sweep

/** Walks the entire body looking for a forbidden key. Returns the path of the
 *  first one found. Depth is limited because deeply nested JSON is a stack
 *  attack, not a daily summary. */
function findForbiddenKey(v: unknown, path = "$", level = 0): string | null {
  if (level > 32) return `${path} (absurd nesting)`;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findForbiddenKey(v[i], `${path}[${i}]`, level + 1);
      if (r) return r;
    }
    return null;
  }
  if (v && typeof v === "object") {
    for (const k of Object.keys(v as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.includes(k)) return `${path}.${k}`;
      const r = findForbiddenKey(
        (v as Record<string, unknown>)[k],
        `${path}.${k}`,
        level + 1,
      );
      if (r) return r;
    }
  }
  return null;
}

// ================================================================== validation

const SKILL_FIELDS: Array<[string, "int" | "num" | "txt" | "bool"]> = [
  ["skill", "txt"],
  ["version", "txt"],
  ["routes", "int"],
  ["activations", "int"],
  ["user_activations", "int"],
  ["turns_judged", "int"],
  ["turns_ok", "int"],
  ["reprompts", "int"],
  ["errors", "int"],
  ["retries", "int"],
  ["tokens_in", "num"],
  ["tokens_out", "num"],
  ["cost_usd", "num"],
  ["median_turns_to_completion", "num"],
  ["ghost", "bool"],
];

/**
 * Hand-written validation. No ajv, no zod: the portal's only npm dependency is
 * the Neon driver, and an 80-line validator for a schema only we generate is
 * easier to audit than a dependency tree. If the schema grows to the point
 * where this hurts, the schema has grown too much.
 *
 * Returns a list of readable reasons — the client has to be able to fix the
 * bug by reading the response, without opening our code.
 */
function validate(p: any): string[] {
  const e: string[] = [];
  const kindOf = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

  if (!p || typeof p !== "object" || Array.isArray(p)) {
    return ["the body has to be a JSON object"];
  }
  if (p.schema !== "batuta.daily_summary.v1") {
    e.push(`field "schema" has to be "batuta.daily_summary.v1" (got: ${JSON.stringify(p.schema)})`);
  }
  if (typeof p.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.day)) {
    e.push('field "day" has to be a YYYY-MM-DD date in UTC');
  } else {
    const d = new Date(`${p.day}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) e.push(`field "day": ${p.day} is not a date that exists`);
    // a day of slack covers timezone and a slightly off clock; beyond that it's a broken clock
    else if (d.getTime() > Date.now() + 36 * 3600 * 1000) {
      e.push(`field "day": ${p.day} is in the future — check the machine's clock`);
    }
  }
  if (typeof p.installation !== "string" || !/^[0-9a-f]{16}$/.test(p.installation)) {
    e.push('field "installation" has to be 16 lowercase hex characters (home::installation_id)');
  }
  for (const k of ["batuta_version", "mode", "declared_bias"]) {
    if (typeof p[k] !== "string" || p[k].length === 0) e.push(`field "${k}" has to be non-empty text`);
    else if (p[k].length > 500) e.push(`field "${k}" is over 500 characters`);
  }
  for (const k of ["routes", "routes_suggested", "routes_holdout"]) {
    if (!Number.isInteger(p[k]) || p[k] < 0) e.push(`field "${k}" has to be an integer >= 0 (got: ${kindOf(p[k])})`);
  }
  for (const k of ["suggested_arm", "holdout_arm"]) {
    const b = p[k];
    if (!b || typeof b !== "object" || Array.isArray(b)) {
      e.push(`field "${k}" has to be an object {ok, n}`);
      continue;
    }
    if (!Number.isInteger(b.ok) || b.ok < 0) e.push(`field "${k}.ok" has to be an integer >= 0`);
    if (!Number.isInteger(b.n) || b.n < 0) e.push(`field "${k}.n" has to be an integer >= 0`);
    if (Number.isInteger(b.ok) && Number.isInteger(b.n) && b.ok > b.n) {
      e.push(`field "${k}": ok=${b.ok} greater than n=${b.n} — successes can't exceed the total`);
    }
  }
  if (!Array.isArray(p.skills)) {
    e.push('field "skills" has to be a list (can be empty: a day with no routes is legitimate data)');
    return e;
  }
  if (p.skills.length > 5000) {
    e.push(`field "skills": ${p.skills.length} entries. That's not a day of use.`);
    return e;
  }
  p.skills.forEach((s: any, i: number) => {
    if (!s || typeof s !== "object" || Array.isArray(s)) {
      e.push(`skills[${i}] has to be an object`);
      return;
    }
    for (const [k, t] of SKILL_FIELDS) {
      const v = s[k];
      if (t === "txt" && typeof v !== "string") e.push(`skills[${i}].${k} has to be text`);
      else if (t === "bool" && typeof v !== "boolean") e.push(`skills[${i}].${k} has to be boolean`);
      else if (t === "int" && (!Number.isInteger(v) || v < 0)) e.push(`skills[${i}].${k} has to be an integer >= 0`);
      else if (t === "num" && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
        e.push(`skills[${i}].${k} has to be a finite number >= 0`);
      }
    }
    if (typeof s.skill === "string" && s.skill.length === 0) e.push(`skills[${i}].skill is empty`);
    if (Number.isInteger(s.turns_ok) && Number.isInteger(s.turns_judged) && s.turns_ok > s.turns_judged) {
      e.push(`skills[${i}]: turns_ok greater than turns_judged`);
    }
    const extras = Object.keys(s).filter((k) => !SKILL_FIELDS.some(([c]) => c === k));
    if (extras.length) e.push(`skills[${i}] has a field that doesn't exist in the schema: ${extras.join(", ")}`);
  });

  const TOP_FIELDS = [
    "schema", "day", "installation", "batuta_version", "mode", "routes",
    "routes_suggested", "routes_holdout", "suggested_arm", "holdout_arm",
    "declared_bias", "skills",
  ];
  const extras = Object.keys(p).filter((k) => !TOP_FIELDS.includes(k));
  if (extras.length) e.push(`field that doesn't exist in the schema: ${extras.join(", ")}`);

  return e;
}

// ======================================================================== POST

export async function POST(req: Request) {
  // database down is 503, not 500: 503 says "try again later", and the
  // client keeps the day's summary to resend (a resend replaces, it doesn't duplicate)
  if (!hasDb()) {
    return json(
      {
        ok: false,
        error: "ingestion unavailable: the portal has no DATABASE_URL configured",
        action: "keep the summary and resend later — resending the same day replaces, it doesn't duplicate",
      },
      503,
    );
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > BYTE_LIMIT) {
    return json({ ok: false, error: `body too large: ${declared} bytes, limit ${BYTE_LIMIT}` }, 413);
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return json({ ok: false, error: "could not read the request body" }, 400);
  }
  // content-length lies; the real size is what counts
  if (new TextEncoder().encode(raw).length > BYTE_LIMIT) {
    return json({ ok: false, error: `body too large: limit ${BYTE_LIMIT} bytes` }, 413);
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    return json({ ok: false, error: `invalid JSON: ${(err as Error).message}` }, 400);
  }

  // FIRST gate, before the schema: if a raw event came in, nothing else matters
  const forbidden = findForbiddenKey(payload);
  if (forbidden) {
    return json(
      {
        ok: false,
        error: `body rejected: forbidden key at ${forbidden}`,
        reason:
          "the keys prompt, prompt_hash, turn and text belong to the LOCAL event format (~/.batuta/events.jsonl), which never gets uploaded. If they arrived here, the client sent a raw event instead of the aggregated daily summary — this is a CLIENT BUG and nothing was recorded.",
        fix:
          "send the output of `batuta summary --day YYYY-MM-DD`, which is the only upload format (schema batuta.daily_summary.v1)",
        report: "https://github.com/batuta/batuta/issues",
      },
      400,
    );
  }

  const problems = validate(payload);
  if (problems.length) {
    return json(
      {
        ok: false,
        error: "body does not match schema batuta.daily_summary.v1",
        problems: problems.slice(0, 25),
        total_problems: problems.length,
        schema: "https://batuta.space/schema/daily-summary.schema.json",
      },
      400,
    );
  }

  // hash of the body in canonical form: it's the receipt. Whoever sent it can run
  // `batuta summary --day X | sha256sum` on their end and compare.
  const hash = await sha256Hex(canonical(payload));

  try {
    await sql`
      insert into batuta.installations (id, batuta_version, mode)
      values (${payload.installation}, ${payload.batuta_version}, ${payload.mode})
      on conflict (id) do update set
        last_seen      = now(),
        batuta_version = excluded.batuta_version,
        mode           = excluded.mode
    `;

    await sql`
      insert into batuta.daily_summaries (installation_id, day, payload, hash)
      values (${payload.installation}, ${payload.day}::date, ${JSON.stringify(payload)}::jsonb, ${hash})
      on conflict (installation_id, day) do update set
        payload     = excluded.payload,
        hash        = excluded.hash,
        received_at = now()
    `;

    // Rollup of the received day, immediately. It's a recalculation of the whole
    // day, not an increment — deliberately idempotent, because a resend replaces.
    // While the fleet is small this costs milliseconds; when it starts hurting,
    // the nightly batch takes over and this turns into a queue. Switching before
    // that would be optimizing in the dark.
    const r = await sql<{ rows: number }>`
      select batuta.recalculate_day_metrics(${payload.day}::date) as rows
    `;

    return json({
      ok: true,
      day: payload.day,
      skills: payload.skills.length,
      metrics_recalculated: r[0]?.rows ?? 0,
      hash,
      kept: "only the aggregated body you sent. No IP, no user agent, no geolocation.",
    });
  } catch (err) {
    console.error("[batuta] ingest failed:", err);
    return json(
      {
        ok: false,
        error: "failed to write",
        action: "resend later — resending the same day replaces, it doesn't duplicate",
      },
      500,
    );
  }
}

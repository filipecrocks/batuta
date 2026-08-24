/**
 * POST /api/arena — anyone submits a task to the battery.
 *
 * The task enters with status 'screening' and canonical_statement NULL,
 * and that's how it has to enter: A SUBMITTED TASK NEVER RUNS AS RECEIVED (§10).
 * Before it runs, it's rewritten into canonical format — statement + acceptance
 * criteria + category + complexity — by whoever maintains the battery. Whoever
 * submits suggests the problem; the ruler belongs to Batuta. Without this gate, a
 * skill author would submit exactly the task their skill wins, and the ranking
 * would turn into a showcase paid for in prestige.
 *
 * The vote that comes afterward orders the test QUEUE. Never the result (§1.6).
 */
import { sql, hasDb } from "../../../lib/db";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATEMENT_LIMIT = 4000;
const BYTE_LIMIT = 64 * 1024;

const CATEGORIES = ["code", "writing", "data", "documents", "research", "automation"];

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function OPTIONS() {
  return json({ ok: false, error: "cross-origin arena submission is not allowed" }, 405, { allow: "POST" });
}

export async function GET() {
  return json({ ok: false, error: "this endpoint only accepts POST", fields: ["statement", "category"] }, 405);
}

// ================================================================== screening 0

/**
 * Automatic screening — the dumb layer, before the human one.
 *
 * It doesn't decide whether the task is good; it decides whether the task is
 * DANGEROUS to keep stored. Executable code blocks and download URLs are refused
 * at the door because the battery runs on people's machines and a task statement
 * is text, not a payload: "write a script that downloads and executes this" is not
 * a test task, it's a payload delivery. Anyone who wants to propose a task about a
 * shell script describes the expected behavior in words — which, incidentally, is
 * what the acceptance criteria will require anyway.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/```[ \t]*(bash|sh|zsh|shell|console|powershell|ps1|bat|cmd|python|py|ruby|rb|perl|php|node|js|javascript|ts)\b/i,
   "executable code block (``` fence with an execution language)"],
  [/^\s*#!\s*\/\w/m, "shebang (#!/...)"],
  [/\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba)?sh\b/i, "curl|sh — pipe-to-shell install"],
  [/\b(rm\s+-rf|mkfs|dd\s+if=|chmod\s+\+x|:\(\)\{.*\};:)/i, "destructive command"],
  [/\b(eval|exec)\s*\(/i, "dynamic execution call"],
  [/https?:\/\/\S+\.(sh|bash|zsh|exe|msi|dmg|pkg|deb|rpm|apk|jar|bin|run|ps1|bat|zip|tar|gz|tgz|7z|rar|iso|whl|pyc)(\?\S*)?(\s|$)/i,
   "file-download URL"],
  [/\b(data|javascript|file|vbscript):[^\s]{16,}/i, "embedded URI with a payload"],
  [/<script\b/i, "<script> tag"],
];

function rejectionReason(t: string): string | null {
  for (const [re, reason] of PATTERNS) if (re.test(t)) return reason;
  return null;
}

// ======================================================================== POST

export async function POST(req: Request) {
  if (!hasDb()) {
    return json({ ok: false, error: "arena unavailable: the portal has no DATABASE_URL configured", action: "try again later" }, 503);
  }

  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    return json({ ok: false, error: "cross-origin arena submission is not allowed" }, 403);
  }
  const idempotencyKey = req.headers.get("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{7,159}$/.test(idempotencyKey)) {
    return json({ ok: false, error: "a valid Idempotency-Key header is required" }, 400);
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > BYTE_LIMIT) {
    return json({ ok: false, error: "body too large" }, 413);
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return json({ ok: false, error: "could not read the request body" }, 400);
  }
  if (new TextEncoder().encode(raw).length > BYTE_LIMIT) {
    return json({ ok: false, error: "body too large" }, 413);
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    return json({ ok: false, error: `invalid JSON: ${(err as Error).message}` }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "the body has to be a JSON object {statement, category}" }, 400);
  }

  const unknownFields = Object.keys(body).filter((key) => !["statement", "category"].includes(key));
  if (unknownFields.length) {
    return json({ ok: false, error: `unknown field(s): ${unknownFields.join(", ")}` }, 400);
  }

  const statement = typeof body.statement === "string" ? body.statement.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim().toLowerCase() : "";

  const problems: string[] = [];
  if (statement.length < 20) {
    problems.push("statement has to be at least 20 characters — describe the task, not its title");
  }
  // 4000 characters is generous for describing a task and tight for pasting a
  // whole file. Anyone who needs more is sending an attachment, not a statement.
  if (statement.length > STATEMENT_LIMIT) {
    problems.push(`statement is ${statement.length} characters; the limit is ${STATEMENT_LIMIT}. Describe what needs to happen and how you know it worked — canonization writes the rest.`);
  }
  if (!CATEGORIES.includes(category)) {
    problems.push(`category has to be one of: ${CATEGORIES.join(", ")}`);
  }
  if (problems.length) return json({ ok: false, error: "submission rejected", problems }, 400);

  const reason = rejectionReason(statement);
  if (reason) {
    return json(
      {
        ok: false,
        error: `submission rejected: ${reason}`,
        reason:
          "the arena accepts a statement in text, not code to execute. A task is a description of what needs to happen and how you know it worked; the code is what the model writes during the test.",
        fix: "describe the expected behavior in words and send it again",
      },
      422,
    );
  }

  try {
    const requestHash = createHash("sha256").update(raw, "utf8").digest("hex");
    const r = await sql<{ submission_status: "accepted" | "replay" | "conflict" | "rate_limited"; task_id: number | null }>`
      select submission_status, task_id
      from batuta.submit_arena_task(
        ${idempotencyKey}, ${requestHash}, ${statement}, ${category}, 20
      )
    `;
    const result = r[0];
    if (!result) throw new Error("submit_arena_task returned no row");
    if (result.submission_status === "rate_limited") {
      return json({ ok: false, error: "arena submission rate limit exceeded" }, 429, { "retry-after": "60" });
    }
    if (result.submission_status === "conflict") {
      return json({ ok: false, error: "idempotency key was reused with a different submission" }, 409);
    }
    const id = result.task_id;

    return json(
      {
        ok: true,
        id,
        status: "screening",
        what_happens_next: [
          "1. screening: we check for duplicates, safety and scope",
          "2. canonization: the task is REWRITTEN into a fixed format — statement + acceptance criteria + category + complexity. It never runs as it arrived, ever.",
          "3. vote: the public vote orders the test queue — and only the queue. A vote doesn't decide the result.",
          "4. round: no-skill arm vs. with-skill arm, order drawn at random, clean session, blind judging",
          "5. publication: the raw data goes out with it (statement, outputs and verdict) and enters the hash chain",
        ],
        the_bar_is_ours:
          "you suggested the problem; we're the ones who write the acceptance criteria. That's the gate that keeps whoever writes a skill from submitting the exact task their skill wins.",
        follow_up: "follow along on the arena page; Batuta does not collect contact details here",
      },
      result.submission_status === "replay" ? 200 : 201,
      result.submission_status === "replay" ? { "x-batuta-idempotent-replay": "true" } : {},
    );
  } catch (err) {
    console.error("[batuta] arena failed:", err);
    return json({ ok: false, error: "failed to write", action: "try again later" }, 500);
  }
}

#!/usr/bin/env node
/**
 * BATUTA — the hash chain of published results (§8).
 *
 *   node script/chain.mjs append <file.json>
 *   node script/chain.mjs verify
 *   node script/chain.mjs ots
 *
 * Pure Node, zero dependency, and it's meant to stay that way: this is the program
 * a distrustful person runs to check Batuta's numbers without trusting Batuta. If
 * verifying required `npm install`, verification would have an owner — and the one
 * thing this project has is no owner of the number (§14.1).
 *
 * The canonical hash below is a deliberate copy of `json::write`
 * (crates/batuta/src/json.rs) and of portal/lib/chain.ts. Three copies, on
 * purpose: none of the three can depend on the others to run. If you touch one,
 * touch all three — and check against a real record before committing.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "records");
const TOP = path.join(DIR, "TOP.txt");
const GENESIS = "0".repeat(64);

// =========================================================== canonical JSON

/** Order by code point — Rust's BTreeMap<String> sorts by UTF-8 bytes,
 *  and JS's default sort() sorts by UTF-16 unit, which diverges outside the BMP. */
function compareKeys(a, b) {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const x = ca[i].codePointAt(0);
    const y = cb[i].codePointAt(0);
    if (x !== y) return x < y ? -1 : 1;
  }
  return ca.length - cb.length;
}

/** Mirror of json::escape. Backspace and form feed go through the generic path
 *  as \u0008 and \u000c, same as Rust — this is exactly where JSON.stringify would
 *  diverge, because it would use the short forms. */
function escape(s) {
  let o = '"';
  for (const c of s) {
    const cp = c.codePointAt(0);
    if (c === '"') o += '\\"';
    else if (c === "\\") o += "\\\\";
    else if (c === "\n") o += "\\n";
    else if (c === "\r") o += "\\r";
    else if (c === "\t") o += "\\t";
    else if (cp < 0x20) o += "\\u" + cp.toString(16).padStart(4, "0");
    else o += c;
  }
  return o + '"';
}

/** An integer stays an integer; the rest rounds to 6 places, breaking ties away
 *  from zero like Rust's f64::round (Math.round breaks ties upward). */
function number(n) {
  if (!Number.isFinite(n)) throw new Error(`number not serializable: ${n}`);
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n === 0 ? 0 : n);
  const scaled = n * 1e6;
  const r = (scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)) / 1e6;
  let s = String(r);
  if (s.includes("e") || s.includes("E")) s = r.toFixed(6).replace(/\.?0+$/, "");
  return s;
}

export function canonical(v) {
  if (v === null || v === undefined) return "null";
  const t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number") return number(v);
  if (t === "string") return escape(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (t === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort(compareKeys);
    return "{" + keys.map((k) => escape(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  throw new Error(`type with no canonical form: ${t}`);
}

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** The link: sha256 of the canonical JSON of {body, previous_hash}. */
export function nextHash(previousHash, body) {
  return sha256(canonical({ body, previous_hash: previousHash ?? GENESIS }));
}

// ============================================================ folder reading

function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .map((name) => {
      const m = /^(\d{6})-(.+)\.json$/.exec(name);
      return m ? { name, n: Number(m[1]), type: m[2] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n);
}

function read(name) {
  const raw = fs.readFileSync(path.join(DIR, name), "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${name}: invalid JSON — ${e.message}`);
  }
}

// ====================================================================== append

function append(file) {
  if (!file) {
    console.error("usage: node script/chain.mjs append <file.json>");
    return 2;
  }
  if (!fs.existsSync(file)) {
    console.error(`could not find ${file}`);
    return 2;
  }

  let body;
  try {
    body = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`${file}: invalid JSON — ${e.message}`);
    return 2;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    console.error(`${file}: the body has to be a JSON object`);
    return 2;
  }

  // The type comes from the body itself, or from the file name. It becomes part
  // of the record's name so the folder is readable without opening anything.
  const rawType =
    typeof body.type === "string" && body.type.trim()
      ? body.type.trim()
      : path.basename(file).replace(/\.json$/i, "");
  const type = rawType.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!type) {
    console.error('could not derive a type; put a "type" field in the body');
    return 2;
  }

  // type and created_at live INSIDE the body — that is, inside the seal. The file
  // repeats both at the top level only for at-a-glance readability; if
  // someone edits the outer copy, `verify` flags the divergence.
  const created_at =
    typeof body.created_at === "string" && body.created_at
      ? body.created_at
      : new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  body.type = type;
  body.created_at = created_at;

  const previous = list();
  let previous_hash = null;
  if (previous.length) {
    const last = read(previous[previous.length - 1].name);
    previous_hash = last.hash;
  }

  const hash = nextHash(previous_hash, body);
  const n = (previous.length ? previous[previous.length - 1].n : 0) + 1;
  const name = `${String(n).padStart(6, "0")}-${type}.json`;

  const record = { type, body, previous_hash, hash, created_at };
  fs.mkdirSync(DIR, { recursive: true });
  // Written indented, and that's safe: the hash is of the CANONICAL JSON of the
  // body, not of the file's bytes. A readable file gives a readable diff in git,
  // which is the second anchor.
  fs.writeFileSync(path.join(DIR, name), JSON.stringify(record, null, 2) + "\n", "utf8");
  fs.writeFileSync(TOP, hash + "\n", "utf8");

  console.log(`appended records/${name}`);
  console.log(`previous ${previous_hash ?? "(genesis)"}`);
  console.log(`hash     ${hash}`);
  console.log("top      records/TOP.txt updated");
  console.log("");
  console.log("now, in order, or it doesn't count:");
  console.log(`  git add records/ && git commit -m "record ${name}" && git push`);
  console.log("  node script/chain.mjs ots     # and stamp TOP.txt");
  return 0;
}

// =================================================================== verify

function verify() {
  const files = list();
  if (!files.length) {
    console.log("empty chain: there is nothing in records/ to verify.");
    return 0;
  }

  let expectedPrevious = null;
  let lastHash = null;

  for (let i = 0; i < files.length; i++) {
    const { name, n, type } = files[i];
    const position = `${name} (position ${i + 1} of ${files.length})`;

    if (n !== i + 1) {
      console.error(`BROKE at ${position}`);
      console.error(
        `  numbering skipped: expected ${String(i + 1).padStart(6, "0")}, found ${String(n).padStart(6, "0")}.`,
      );
      console.error("  either a record is missing from the folder, or someone renamed a file.");
      return 1;
    }

    let r;
    try {
      r = read(name);
    } catch (e) {
      console.error(`BROKE at ${position}\n  ${e.message}`);
      return 1;
    }

    for (const field of ["type", "body", "hash"]) {
      if (r[field] === undefined) {
        console.error(`BROKE at ${position}\n  missing field "${field}".`);
        return 1;
      }
    }

    const declaredPrevious = r.previous_hash ?? null;
    if (i === 0) {
      if (declaredPrevious !== null && declaredPrevious !== GENESIS) {
        console.error(`BROKE at ${position}`);
        console.error(`  it's the first record, but it points at ${declaredPrevious}.`);
        console.error("  the start of the chain is missing.");
        return 1;
      }
    } else if (declaredPrevious !== expectedPrevious) {
      console.error(`BROKE at ${position}`);
      console.error(`  declared previous_hash: ${declaredPrevious ?? "(null)"}`);
      console.error(`  previous record's hash: ${expectedPrevious}`);
      console.error("  the links don't line up: a record was removed, reordered, or rewritten.");
      return 1;
    }

    const recalculated = nextHash(declaredPrevious, r.body);
    if (recalculated !== r.hash) {
      console.error(`BROKE at ${position}`);
      console.error(`  declared hash:    ${r.hash}`);
      console.error(`  recalculated hash: ${recalculated}`);
      console.error("  the CONTENT of this record was altered after it was published.");
      console.error(`  compare against git: git log --follow -p records/${name}`);
      return 1;
    }

    // the copies outside the seal have to match the ones inside
    if (r.type !== r.body?.type || (r.created_at ?? null) !== (r.body?.created_at ?? null)) {
      console.error(`BROKE at ${position}`);
      console.error("  the file's header doesn't match the sealed body:");
      console.error(`    outside: type=${r.type} created_at=${r.created_at}`);
      console.error(`    inside:  type=${r.body?.type} created_at=${r.body?.created_at}`);
      return 1;
    }
    if (r.type !== type) {
      console.error(`BROKE at ${position}\n  the file name says "${type}" and the record says "${r.type}".`);
      return 1;
    }

    expectedPrevious = r.hash;
    lastHash = r.hash;
  }

  const top = fs.existsSync(TOP) ? fs.readFileSync(TOP, "utf8").trim() : null;
  if (top !== lastHash) {
    console.error("BROKE at TOP.txt");
    console.error(`  TOP.txt says:    ${top ?? "(does not exist)"}`);
    console.error(`  last record is:  ${lastHash}`);
    console.error(
      "  the OpenTimestamps stamp is over TOP.txt: if it's wrong, the stamp proves nothing.",
    );
    return 1;
  }

  console.log(`whole chain: ${files.length} record(s), no broken link.`);
  console.log(`top: ${lastHash}`);
  console.log("");
  console.log("this proves no record was edited after being chained.");
  console.log("it does NOT prove the numbers are correct, or WHEN they were recorded —");
  console.log("for the date, see `node script/chain.mjs ots`.");
  return 0;
}

// ========================================================================= ots

function ots() {
  const top = fs.existsSync(TOP)
    ? fs.readFileSync(TOP, "utf8").trim()
    : "(TOP.txt does not exist yet)";
  console.log("OpenTimestamps — the third anchor (§8)\n");
  console.log("install the client (once):");
  console.log("  pip install opentimestamps-client\n");
  console.log("stamp the top of the chain:");
  console.log("  ots stamp records/TOP.txt");
  console.log("  git add records/TOP.txt records/TOP.txt.ots");
  console.log(`  git commit -m "stamp top ${top.slice(0, 12)}" && git push\n`);
  console.log("check later (the stamp takes a few hours to settle on Bitcoin):");
  console.log("  ots upgrade records/TOP.txt.ots");
  console.log("  ots verify records/TOP.txt.ots\n");
  console.log(`current top: ${top}\n`);
  console.log("WHAT THIS PROVES, in five lines:");
  console.log("1. That this hash existed before the Bitcoin block that stamped it — dated, within hours.");
  console.log("2. That the top record, and every previous one through the chain, predate that date.");
  console.log("3. That no one, us included, can move that date backward once it's issued.");
  console.log("IT DOES NOT PROVE:");
  console.log("4. That the measured numbers are correct — a stamp is a notary of date, not an audit of method.");
  console.log("5. That there isn't a second set of records never published: it proves what was stamped, nothing about what was left out.");
  return 0;
}

// ======================================================================== main

function help() {
  console.log(`BATUTA — hash chain

  node script/chain.mjs append <file.json>   writes the next link in records/
  node script/chain.mjs verify               walks the whole chain
  node script/chain.mjs ots                  how to stamp the top, and what it proves

The chain only moves forward. To fix a wrong record, append a new record
of type "correction" pointing at the hash of the wrong one — the mistake stays visible.
`);
  return 0;
}

// Only runs as a program. Without this guard, importing `canonical`/`nextHash`
// from here (the Rust compatibility test does this) would execute main and kill
// the process of whoever imported it.
const running =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (running) {
  const [verb, ...rest] = process.argv.slice(2);
  let code = 0;
  try {
    if (verb === "append" || verb === "anexar") code = append(rest[0]);
    else if (verb === "verify" || verb === "verificar") code = verify();
    else if (verb === "ots") code = ots();
    else code = help();
  } catch (e) {
    console.error(`error: ${e.message}`);
    code = 1;
  }
  process.exit(code);
}

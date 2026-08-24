/**
 * Canonical hash of the Batuta chain (§8).
 *
 * Three implementations need to produce the SAME byte for the same data:
 * `json::escrever` in crates/batuta/src/json.rs (Rust), `script/cadeia.mjs` (pure
 * Node, the one that writes) and this file (portal, the one that verifies in front
 * of the visitor). If the three diverge by so much as a whitespace, the chain
 * "breaks" without anyone having touched anything, and the project loses
 * credibility over a formatting bug. That's why the serialization below is
 * hand-written instead of using `JSON.stringify`: it needs to match Rust, not
 * ECMA-262.
 *
 * Runs on edge and on node: only WebCrypto, zero dependency.
 */

/** The first link points to nothing, and nothing has a fixed shape. */
export const GENESIS = "0".repeat(64);

export type Registro = {
  tipo: string;
  corpo: unknown;
  hash: string;
  hash_anterior: string | null;
  criado_em?: string;
};

// ------------------------------------------------------------------ canonical

/**
 * Key order = code point order.
 *
 * Rust uses BTreeMap<String>, which sorts by UTF-8 bytes — and UTF-8 byte order is
 * exactly code point order. JavaScript's `sort()` sorts by UTF-16 unit, which
 * reverses pairs outside the BMP (an emoji would end up before "" on one side and
 * after it on the other). With an ASCII key it comes out the same; with a record
 * key in another alphabet, it produces a different hash. Costs three lines to avoid.
 */
function compararChaves(a: string, b: string): number {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const x = ca[i].codePointAt(0) as number;
    const y = cb[i].codePointAt(0) as number;
    if (x !== y) return x < y ? -1 : 1;
  }
  return ca.length - cb.length;
}

/** Exact mirror of Rust's `json::escapar`. Note \b and \f: Rust sends both
 *  through the generic \u00XX path, while JSON.stringify would use \b and \f. */
function escapar(s: string): string {
  let o = '"';
  for (const c of s) {
    if (c === '"') o += '\\"';
    else if (c === "\\") o += "\\\\";
    else if (c === "\n") o += "\\n";
    else if (c === "\r") o += "\\r";
    else if (c === "\t") o += "\\t";
    else if ((c.codePointAt(0) as number) < 0x20) {
      o += "\\u" + (c.codePointAt(0) as number).toString(16).padStart(4, "0");
    } else o += c;
  }
  return o + '"';
}

/**
 * Mirror of how Rust prints f64: a pure integer comes out with no decimal
 * place, the rest is rounded to 6 places. Rust's rounding (`f64::round`) breaks
 * ties away from zero; JS's `Math.round` breaks ties upward. It only differs on
 * an exact negative half (-0.5), which doesn't show up in cost or count fields —
 * but the number has to match always, not almost always.
 */
function numero(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`numero nao serializavel na corrente: ${n}`);
  }
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n === 0 ? 0 : n);
  const escala = n * 1e6;
  const arredondado =
    (escala < 0 ? -Math.round(-escala) : Math.round(escala)) / 1e6;
  let s = String(arredondado);
  // Rust's Display never uses scientific notation; JS's String() uses it outside
  // the range [1e-6, 1e21)
  if (s.includes("e") || s.includes("E")) {
    s = arredondado.toFixed(6).replace(/\.?0+$/, "");
  }
  return s;
}

/** Canonical JSON: keys in order, without a single space. */
export function canonico(v: unknown): string {
  if (v === null || v === undefined) return "null";
  const t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number") return numero(v as number);
  if (t === "string") return escapar(v as string);
  if (Array.isArray(v)) return "[" + v.map(canonico).join(",") + "]";
  if (t === "object") {
    const m = v as Record<string, unknown>;
    const chaves = Object.keys(m)
      // undefined doesn't exist on the Rust side; treating it as absent is what
      // JSON.stringify does, and it's what keeps both sides equal
      .filter((k) => m[k] !== undefined)
      .sort(compararChaves);
    return (
      "{" +
      chaves.map((k) => escapar(k) + ":" + canonico(m[k])).join(",") +
      "}"
    );
  }
  throw new Error(`tipo sem forma canonica: ${t}`);
}

// ---------------------------------------------------------------------- hash

export async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const dig = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(dig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The link. The preimage is the canonical JSON of `{corpo, hash_anterior}` — the
 * whole body, plus the hash of whatever came before. Altering any old record
 * changes its hash, which is the next one's `hash_anterior`, which changes the
 * next one's hash, and so on to the top: that's why tampering shows up in front
 * of everyone, not just whoever went to check that particular record.
 *
 * Project convention: `tipo` and `criado_em` also live INSIDE the body, and the
 * file in registros/ repeats them at the top level only for readability. Without
 * that, the record's date and label would sit outside the seal.
 */
export async function proximoHash(
  hashAnterior: string | null,
  corpo: unknown,
): Promise<string> {
  return sha256Hex(
    canonico({ corpo, hash_anterior: hashAnterior ?? GENESIS }),
  );
}

/**
 * Checks the entire chain and returns the INDEX of the first broken link, or -1
 * if it's intact. Index, not id: this function also runs over lists that came
 * from the database, where a record in the middle can be missing, and "the third
 * one you showed me" is a more honest claim than "record 3".
 */
export async function verificarCadeia(registros: Registro[]): Promise<number> {
  let anterior: string | null = null;
  for (let i = 0; i < registros.length; i++) {
    const r = registros[i];
    const esperadoAnterior = i === 0 ? (r.hash_anterior ?? GENESIS) : anterior;
    if ((r.hash_anterior ?? GENESIS) !== (esperadoAnterior ?? GENESIS)) return i;
    const recalculado = await proximoHash(r.hash_anterior, r.corpo);
    if (recalculado !== r.hash) return i;
    anterior = r.hash;
  }
  return -1;
}

/** Readable reason for the broken link — so the audit page can say what happened
 *  instead of showing a raw index. */
export async function motivoQuebra(
  registros: Registro[],
  i: number,
): Promise<string> {
  const r = registros[i];
  if (!r) return "indice fora da lista";
  const recalculado = await proximoHash(r.hash_anterior, r.corpo);
  if (recalculado !== r.hash) {
    return `o corpo do registro nao produz o hash declarado: calculado ${recalculado}, declarado ${r.hash}. O conteudo foi alterado depois de publicado.`;
  }
  return `o registro aponta para ${r.hash_anterior ?? "(nada)"}, mas o anterior nesta lista tem hash ${registros[i - 1]?.hash ?? "(nenhum)"}. Ou falta um registro no meio, ou a ordem foi trocada.`;
}

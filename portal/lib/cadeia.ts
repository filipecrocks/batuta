/**
 * Hash canônico da corrente do Batuta (§8).
 *
 * Três implementações precisam produzir o MESMO byte para o mesmo dado:
 * `json::escrever` em crates/batuta/src/json.rs (Rust), `script/cadeia.mjs` (Node
 * puro, é quem grava) e este arquivo (portal, é quem confere na frente de quem
 * visita). Se as três divergirem em um espaço em branco, a corrente "quebra" sem
 * ninguém ter mexido em nada e o projeto perde a credibilidade por bug de
 * formatação. Por isso a serialização abaixo é escrita à mão em vez de
 * `JSON.stringify`: precisa bater com o Rust, não com o ECMA-262.
 *
 * Roda em edge e em node: só WebCrypto, zero dependência.
 */

/** O primeiro elo aponta para o nada, e o nada tem forma fixa. */
export const GENESIS = "0".repeat(64);

export type Registro = {
  tipo: string;
  corpo: unknown;
  hash: string;
  hash_anterior: string | null;
  criado_em?: string;
};

// ------------------------------------------------------------------ canônico

/**
 * Ordem das chaves = ordem dos code points.
 *
 * O Rust usa BTreeMap<String>, que ordena pelos bytes do UTF-8 — e ordem de bytes
 * UTF-8 é exatamente ordem de code point. O `sort()` do JavaScript ordena por
 * unidade UTF-16, que inverte pares fora do BMP (um emoji ficaria antes de "" em
 * um lado e depois no outro). Com chave ASCII dá na mesma; com uma chave de
 * registro em outro alfabeto, dá hash diferente. Custa três linhas evitar.
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

/** Espelho exato de `json::escapar` do Rust. Note \b e \f: o Rust manda os dois
 *  pelo caminho genérico \u00XX, e o JSON.stringify usaria \b e \f. */
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
 * Espelho de como o Rust imprime f64: inteiro puro sai sem casa decimal, o resto
 * é arredondado a 6 casas. O arredondamento do Rust (`f64::round`) desempata para
 * longe do zero; o `Math.round` do JS desempata para cima. Só difere em negativo
 * exato (-0.5), que não aparece em custo nem em contagem — mas o número tem que
 * bater sempre, não quase sempre.
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
  // o Display do Rust nunca usa notação científica; o String() do JS usa fora da
  // faixa [1e-6, 1e21)
  if (s.includes("e") || s.includes("E")) {
    s = arredondado.toFixed(6).replace(/\.?0+$/, "");
  }
  return s;
}

/** JSON canônico: chaves em ordem, sem um espaço sequer. */
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
      // undefined não existe no lado Rust; tratá-lo como ausente é o que o
      // JSON.stringify faz e é o que mantém os dois lados iguais
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
 * O elo. A pré-imagem é o JSON canônico de `{corpo, hash_anterior}` — o corpo
 * inteiro, mais o hash de quem veio antes. Alterar qualquer registro antigo muda o
 * hash dele, que é o `hash_anterior` do próximo, que muda o hash do próximo, e
 * assim até o topo: é por isso que a adulteração aparece na frente de todo mundo e
 * não só de quem foi conferir aquele registro.
 *
 * Convenção do projeto: `tipo` e `criado_em` também vivem DENTRO do corpo, e o
 * arquivo em registros/ os repete no nível de cima só para ser legível. Sem isso,
 * a data e o rótulo do registro ficariam fora do lacre.
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
 * Confere a corrente inteira e devolve o ÍNDICE do primeiro elo quebrado, ou -1 se
 * está intacta. Índice e não id: esta função também roda sobre a lista que veio do
 * banco, onde pode faltar registro no meio, e "o terceiro que você me mostrou" é
 * uma afirmação mais honesta que "o registro 3".
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

/** Motivo legível do elo quebrado — para a página de auditoria dizer o que houve
 *  em vez de mostrar um índice cru. */
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

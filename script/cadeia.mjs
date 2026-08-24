#!/usr/bin/env node
/**
 * BATUTA — a corrente de hash dos resultados publicados (§8).
 *
 *   node script/cadeia.mjs anexar <arquivo.json>
 *   node script/cadeia.mjs verificar
 *   node script/cadeia.mjs ots
 *
 * Node puro, zero dependência, e é para continuar assim: este é o programa que uma
 * pessoa desconfiada roda para conferir os números do Batuta sem confiar no Batuta.
 * Se para verificar fosse preciso `npm install`, a verificação teria dono — e a
 * única coisa que este projeto tem é não ter dono do número (§14.1).
 *
 * O hash canônico abaixo é uma cópia deliberada de `json::escrever`
 * (crates/batuta/src/json.rs) e de portal/lib/cadeia.ts. Três cópias, de propósito:
 * nenhuma das três pode depender das outras para rodar. Se você mexer em uma, mexa
 * nas três — e confira com um registro real antes de commitar.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(RAIZ, "registros");
const TOPO = path.join(DIR, "TOPO.txt");
const GENESIS = "0".repeat(64);

// =========================================================== JSON canônico

/** Ordem por code point — o BTreeMap<String> do Rust ordena pelos bytes do UTF-8,
 *  e o sort() padrão do JS ordena por unidade UTF-16, que diverge fora do BMP. */
function compararChaves(a, b) {
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

/** Espelho de json::escapar. Backspace e form feed saem pelo caminho genérico
 *  como \u0008 e \u000c, igual ao Rust — é exatamente onde o JSON.stringify divergiria,
 *  porque ele usaria as formas curtas. */
function escapar(s) {
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

/** Inteiro sai inteiro; o resto arredonda em 6 casas, desempatando para longe do
 *  zero como o f64::round do Rust (o Math.round desempata para cima). */
function numero(n) {
  if (!Number.isFinite(n)) throw new Error(`numero nao serializavel: ${n}`);
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n === 0 ? 0 : n);
  const escala = n * 1e6;
  const r = (escala < 0 ? -Math.round(-escala) : Math.round(escala)) / 1e6;
  let s = String(r);
  if (s.includes("e") || s.includes("E")) s = r.toFixed(6).replace(/\.?0+$/, "");
  return s;
}

export function canonico(v) {
  if (v === null || v === undefined) return "null";
  const t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number") return numero(v);
  if (t === "string") return escapar(v);
  if (Array.isArray(v)) return "[" + v.map(canonico).join(",") + "]";
  if (t === "object") {
    const chaves = Object.keys(v).filter((k) => v[k] !== undefined).sort(compararChaves);
    return "{" + chaves.map((k) => escapar(k) + ":" + canonico(v[k])).join(",") + "}";
  }
  throw new Error(`tipo sem forma canonica: ${t}`);
}

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** O elo: sha256 do JSON canônico de {corpo, hash_anterior}. */
export function proximoHash(hashAnterior, corpo) {
  return sha256(canonico({ corpo, hash_anterior: hashAnterior ?? GENESIS }));
}

// ============================================================ leitura da pasta

function listar() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .map((nome) => {
      const m = /^(\d{6})-(.+)\.json$/.exec(nome);
      return m ? { nome, n: Number(m[1]), tipo: m[2] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n);
}

function ler(nome) {
  const bruto = fs.readFileSync(path.join(DIR, nome), "utf8");
  try {
    return JSON.parse(bruto);
  } catch (e) {
    throw new Error(`${nome}: JSON invalido — ${e.message}`);
  }
}

// ====================================================================== anexar

function anexar(arquivo) {
  if (!arquivo) {
    console.error("uso: node script/cadeia.mjs anexar <arquivo.json>");
    return 2;
  }
  if (!fs.existsSync(arquivo)) {
    console.error(`nao achei ${arquivo}`);
    return 2;
  }

  let corpo;
  try {
    corpo = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  } catch (e) {
    console.error(`${arquivo}: JSON invalido — ${e.message}`);
    return 2;
  }
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    console.error(`${arquivo}: o corpo tem que ser um objeto JSON`);
    return 2;
  }

  // O tipo vem do próprio corpo, ou do nome do arquivo. Ele vira parte do nome do
  // registro para a pasta ser legível sem abrir nada.
  const tipoBruto =
    typeof corpo.tipo === "string" && corpo.tipo.trim()
      ? corpo.tipo.trim()
      : path.basename(arquivo).replace(/\.json$/i, "");
  const tipo = tipoBruto.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!tipo) {
    console.error('nao consegui derivar um tipo; ponha um campo "tipo" no corpo');
    return 2;
  }

  // tipo e criado_em vivem DENTRO do corpo — logo, dentro do lacre. O arquivo
  // repete os dois no nível de cima só para ser legível de bater o olho; se
  // alguém editar a cópia de fora, `verificar` acusa a divergência.
  const criado_em =
    typeof corpo.criado_em === "string" && corpo.criado_em
      ? corpo.criado_em
      : new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  corpo.tipo = tipo;
  corpo.criado_em = criado_em;

  const anteriores = listar();
  let hash_anterior = null;
  if (anteriores.length) {
    const ultimo = ler(anteriores[anteriores.length - 1].nome);
    hash_anterior = ultimo.hash;
  }

  const hash = proximoHash(hash_anterior, corpo);
  const n = (anteriores.length ? anteriores[anteriores.length - 1].n : 0) + 1;
  const nome = `${String(n).padStart(6, "0")}-${tipo}.json`;

  const registro = { tipo, corpo, hash_anterior, hash, criado_em };
  fs.mkdirSync(DIR, { recursive: true });
  // Gravado indentado, e isso é seguro: o hash é do JSON CANÔNICO do corpo, não dos
  // bytes do arquivo. Arquivo legível dá diff legível no git, que é a segunda âncora.
  fs.writeFileSync(path.join(DIR, nome), JSON.stringify(registro, null, 2) + "\n", "utf8");
  fs.writeFileSync(TOPO, hash + "\n", "utf8");

  console.log(`anexado  registros/${nome}`);
  console.log(`anterior ${hash_anterior ?? "(genesis)"}`);
  console.log(`hash     ${hash}`);
  console.log("topo     registros/TOPO.txt atualizado");
  console.log("");
  console.log("agora, na ordem, senao nao vale:");
  console.log(`  git add registros/ && git commit -m "registro ${nome}" && git push`);
  console.log("  node script/cadeia.mjs ots     # e carimbe o TOPO.txt");
  return 0;
}

// =================================================================== verificar

function verificar() {
  const arquivos = listar();
  if (!arquivos.length) {
    console.log("corrente vazia: nao ha nada em registros/ para verificar.");
    return 0;
  }

  let esperadoAnterior = null;
  let ultimoHash = null;

  for (let i = 0; i < arquivos.length; i++) {
    const { nome, n, tipo } = arquivos[i];
    const posicao = `${nome} (posicao ${i + 1} de ${arquivos.length})`;

    if (n !== i + 1) {
      console.error(`QUEBROU em ${posicao}`);
      console.error(
        `  a numeracao pulou: esperava ${String(i + 1).padStart(6, "0")}, achei ${String(n).padStart(6, "0")}.`,
      );
      console.error("  ou falta um registro na pasta, ou alguem renomeou arquivo.");
      return 1;
    }

    let r;
    try {
      r = ler(nome);
    } catch (e) {
      console.error(`QUEBROU em ${posicao}\n  ${e.message}`);
      return 1;
    }

    for (const campo of ["tipo", "corpo", "hash"]) {
      if (r[campo] === undefined) {
        console.error(`QUEBROU em ${posicao}\n  falta o campo "${campo}".`);
        return 1;
      }
    }

    const anteriorDeclarado = r.hash_anterior ?? null;
    if (i === 0) {
      if (anteriorDeclarado !== null && anteriorDeclarado !== GENESIS) {
        console.error(`QUEBROU em ${posicao}`);
        console.error(`  e o primeiro registro, mas aponta para ${anteriorDeclarado}.`);
        console.error("  o comeco da corrente sumiu.");
        return 1;
      }
    } else if (anteriorDeclarado !== esperadoAnterior) {
      console.error(`QUEBROU em ${posicao}`);
      console.error(`  hash_anterior declarado:   ${anteriorDeclarado ?? "(nulo)"}`);
      console.error(`  hash do registro anterior: ${esperadoAnterior}`);
      console.error("  os elos nao se encaixam: registro removido, reordenado ou reescrito.");
      return 1;
    }

    const recalculado = proximoHash(anteriorDeclarado, r.corpo);
    if (recalculado !== r.hash) {
      console.error(`QUEBROU em ${posicao}`);
      console.error(`  hash declarado:   ${r.hash}`);
      console.error(`  hash recalculado: ${recalculado}`);
      console.error("  o CONTEUDO deste registro foi alterado depois de publicado.");
      console.error(`  compare com o git: git log --follow -p registros/${nome}`);
      return 1;
    }

    // as cópias de fora do lacre têm que bater com as de dentro
    if (r.tipo !== r.corpo?.tipo || (r.criado_em ?? null) !== (r.corpo?.criado_em ?? null)) {
      console.error(`QUEBROU em ${posicao}`);
      console.error("  o cabecalho do arquivo nao bate com o corpo lacrado:");
      console.error(`    fora:   tipo=${r.tipo} criado_em=${r.criado_em}`);
      console.error(`    dentro: tipo=${r.corpo?.tipo} criado_em=${r.corpo?.criado_em}`);
      return 1;
    }
    if (r.tipo !== tipo) {
      console.error(`QUEBROU em ${posicao}\n  o nome do arquivo diz "${tipo}" e o registro diz "${r.tipo}".`);
      return 1;
    }

    esperadoAnterior = r.hash;
    ultimoHash = r.hash;
  }

  const topo = fs.existsSync(TOPO) ? fs.readFileSync(TOPO, "utf8").trim() : null;
  if (topo !== ultimoHash) {
    console.error("QUEBROU no TOPO.txt");
    console.error(`  TOPO.txt diz:      ${topo ?? "(nao existe)"}`);
    console.error(`  ultimo registro e: ${ultimoHash}`);
    console.error(
      "  o carimbo do OpenTimestamps e sobre o TOPO.txt: com ele errado, o carimbo nao prova nada.",
    );
    return 1;
  }

  console.log(`corrente inteira: ${arquivos.length} registro(s), nenhum elo quebrado.`);
  console.log(`topo: ${ultimoHash}`);
  console.log("");
  console.log("isto prova que nenhum registro foi editado depois de encadeado.");
  console.log("NAO prova que os numeros estao certos, nem QUANDO foram gravados —");
  console.log("para a data, veja `node script/cadeia.mjs ots`.");
  return 0;
}

// ========================================================================= ots

function ots() {
  const topo = fs.existsSync(TOPO)
    ? fs.readFileSync(TOPO, "utf8").trim()
    : "(TOPO.txt ainda nao existe)";
  console.log("OpenTimestamps — a terceira ancora (§8)\n");
  console.log("instalar o cliente (uma vez):");
  console.log("  pip install opentimestamps-client\n");
  console.log("carimbar o topo da corrente:");
  console.log("  ots stamp registros/TOPO.txt");
  console.log("  git add registros/TOPO.txt registros/TOPO.txt.ots");
  console.log(`  git commit -m "carimbo do topo ${topo.slice(0, 12)}" && git push\n`);
  console.log("conferir depois (o carimbo leva algumas horas para fechar no Bitcoin):");
  console.log("  ots upgrade registros/TOPO.txt.ots");
  console.log("  ots verify registros/TOPO.txt.ots\n");
  console.log(`topo atual: ${topo}\n`);
  console.log("O QUE ISSO PROVA, em cinco linhas:");
  console.log("1. Que este hash existia antes do bloco de Bitcoin que o carimbou — data, com margem de horas.");
  console.log("2. Que o registro do topo, e todos os anteriores por encadeamento, sao anteriores aquela data.");
  console.log("3. Que ninguem, nem nos, consegue mover essa data para tras depois de emitida.");
  console.log("NAO PROVA:");
  console.log("4. Que os numeros medidos estao certos — carimbo e cartorio de data, nao auditoria de metodo.");
  console.log("5. Que nao existe um segundo conjunto de registros nunca publicado: prova o que foi carimbado, nada sobre o que ficou de fora.");
  return 0;
}

// ======================================================================== main

function ajuda() {
  console.log(`BATUTA — corrente de hash

  node script/cadeia.mjs anexar <arquivo.json>   grava o proximo elo em registros/
  node script/cadeia.mjs verificar               percorre a corrente inteira
  node script/cadeia.mjs ots                     como carimbar o topo, e o que isso prova

A corrente so anda para frente. Para corrigir um registro errado, anexe um registro
novo do tipo "correcao" apontando para o hash do errado — o erro fica visivel.
`);
  return 0;
}

// So roda como programa. Sem esta guarda, importar `canonico`/`proximoHash` daqui
// (o teste de compatibilidade com o Rust faz isso) executaria o main e mataria o
// processo de quem importou.
const executando =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executando) {
  const [verbo, ...resto] = process.argv.slice(2);
  let saida = 0;
  try {
    if (verbo === "anexar") saida = anexar(resto[0]);
    else if (verbo === "verificar") saida = verificar();
    else if (verbo === "ots") saida = ots();
    else saida = ajuda();
  } catch (e) {
    console.error(`erro: ${e.message}`);
    saida = 1;
  }
  process.exit(saida);
}

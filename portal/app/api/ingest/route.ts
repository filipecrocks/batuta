/**
 * POST /api/ingest — receives ONE aggregated daily summary (schema batuta.resumo_diario.v1).
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
import { sql, temBanco } from "../../../lib/db";
import { canonico, sha256Hex } from "../../../lib/cadeia";

// Needs node: the canonical hash and the driver run on both runtimes, but
// ingestion is a write path and we prefer the runtime that gives a full
// stack trace when something breaks at 3am.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 256 KB. A day of heavy use produces a few KB (~20 lines per installation); anyone
 *  sending more than that is sending something else. */
const LIMITE_BYTES = 256 * 1024;

/** If any of these show up at any level, the body is a raw event. */
const CHAVES_PROIBIDAS = ["prompt", "prompt_hash", "turno", "texto"];

const CORS: Record<string, string> = {
  // The binary runs on the machine of whoever installed it, not on a domain of
  // ours: there's no origin to restrict. What restricts is the method — POST only.
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
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
      erro: "este endereço só aceita POST",
      formato: "https://batuta.space/schema/resumo-diario.schema.json",
      dica: "para ver o que o seu Batuta mandaria, rode `batuta resumo` — ele imprime o corpo exato, e nada sai da máquina enquanto `envio` estiver desligado",
    },
    405,
  );
}

// =========================================================== key sweep

/** Walks the entire body looking for a forbidden key. Returns the path of the
 *  first one found. Depth is limited because deeply nested JSON is a stack
 *  attack, not a daily summary. */
function acharChaveProibida(v: unknown, caminho = "$", nivel = 0): string | null {
  if (nivel > 32) return `${caminho} (aninhamento absurdo)`;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = acharChaveProibida(v[i], `${caminho}[${i}]`, nivel + 1);
      if (r) return r;
    }
    return null;
  }
  if (v && typeof v === "object") {
    for (const k of Object.keys(v as Record<string, unknown>)) {
      if (CHAVES_PROIBIDAS.includes(k)) return `${caminho}.${k}`;
      const r = acharChaveProibida(
        (v as Record<string, unknown>)[k],
        `${caminho}.${k}`,
        nivel + 1,
      );
      if (r) return r;
    }
  }
  return null;
}

// ================================================================== validation

const CAMPOS_SKILL: Array<[string, "int" | "num" | "txt" | "bool"]> = [
  ["skill", "txt"],
  ["versao", "txt"],
  ["rotas", "int"],
  ["ativacoes", "int"],
  ["ativacoes_usuario", "int"],
  ["turnos_julgados", "int"],
  ["turnos_ok", "int"],
  ["reprompts", "int"],
  ["erros", "int"],
  ["retries", "int"],
  ["tokens_in", "num"],
  ["tokens_out", "num"],
  ["custo_usd", "num"],
  ["turnos_ate_fim_mediana", "num"],
  ["fantasma", "bool"],
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
function validar(p: any): string[] {
  const e: string[] = [];
  const tipo = (v: unknown) => (Array.isArray(v) ? "lista" : v === null ? "nulo" : typeof v);

  if (!p || typeof p !== "object" || Array.isArray(p)) {
    return ["o corpo tem que ser um objeto JSON"];
  }
  if (p.schema !== "batuta.resumo_diario.v1") {
    e.push(`campo "schema" tem que ser "batuta.resumo_diario.v1" (veio: ${JSON.stringify(p.schema)})`);
  }
  if (typeof p.dia !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.dia)) {
    e.push('campo "dia" tem que ser uma data AAAA-MM-DD em UTC');
  } else {
    const d = new Date(`${p.dia}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) e.push(`campo "dia": ${p.dia} não é uma data que existe`);
    // a day of slack covers timezone and a slightly off clock; beyond that it's a broken clock
    else if (d.getTime() > Date.now() + 36 * 3600 * 1000) {
      e.push(`campo "dia": ${p.dia} está no futuro — confira o relógio da máquina`);
    }
  }
  if (typeof p.instalacao !== "string" || !/^[0-9a-f]{16}$/.test(p.instalacao)) {
    e.push('campo "instalacao" tem que ser 16 caracteres hexadecimais minúsculos (casa::id_instalacao)');
  }
  for (const k of ["batuta_versao", "modo", "vies_declarado"]) {
    if (typeof p[k] !== "string" || p[k].length === 0) e.push(`campo "${k}" tem que ser texto não vazio`);
    else if (p[k].length > 500) e.push(`campo "${k}" passou de 500 caracteres`);
  }
  for (const k of ["rotas", "rotas_com_sugestao", "rotas_holdout"]) {
    if (!Number.isInteger(p[k]) || p[k] < 0) e.push(`campo "${k}" tem que ser inteiro >= 0 (veio: ${tipo(p[k])})`);
  }
  for (const k of ["braco_com", "braco_holdout"]) {
    const b = p[k];
    if (!b || typeof b !== "object" || Array.isArray(b)) {
      e.push(`campo "${k}" tem que ser um objeto {ok, n}`);
      continue;
    }
    if (!Number.isInteger(b.ok) || b.ok < 0) e.push(`campo "${k}.ok" tem que ser inteiro >= 0`);
    if (!Number.isInteger(b.n) || b.n < 0) e.push(`campo "${k}.n" tem que ser inteiro >= 0`);
    if (Number.isInteger(b.ok) && Number.isInteger(b.n) && b.ok > b.n) {
      e.push(`campo "${k}": ok=${b.ok} maior que n=${b.n} — sucesso não pode passar do total`);
    }
  }
  if (!Array.isArray(p.skills)) {
    e.push('campo "skills" tem que ser uma lista (pode ser vazia: dia sem rota é dado legítimo)');
    return e;
  }
  if (p.skills.length > 5000) {
    e.push(`campo "skills": ${p.skills.length} entradas. Isso não é um dia de uso.`);
    return e;
  }
  p.skills.forEach((s: any, i: number) => {
    if (!s || typeof s !== "object" || Array.isArray(s)) {
      e.push(`skills[${i}] tem que ser um objeto`);
      return;
    }
    for (const [k, t] of CAMPOS_SKILL) {
      const v = s[k];
      if (t === "txt" && typeof v !== "string") e.push(`skills[${i}].${k} tem que ser texto`);
      else if (t === "bool" && typeof v !== "boolean") e.push(`skills[${i}].${k} tem que ser booleano`);
      else if (t === "int" && (!Number.isInteger(v) || v < 0)) e.push(`skills[${i}].${k} tem que ser inteiro >= 0`);
      else if (t === "num" && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
        e.push(`skills[${i}].${k} tem que ser número finito >= 0`);
      }
    }
    if (typeof s.skill === "string" && s.skill.length === 0) e.push(`skills[${i}].skill está vazio`);
    if (Number.isInteger(s.turnos_ok) && Number.isInteger(s.turnos_julgados) && s.turnos_ok > s.turnos_julgados) {
      e.push(`skills[${i}]: turnos_ok maior que turnos_julgados`);
    }
    const extras = Object.keys(s).filter((k) => !CAMPOS_SKILL.some(([c]) => c === k));
    if (extras.length) e.push(`skills[${i}] tem campo que não existe no schema: ${extras.join(", ")}`);
  });

  const CAMPOS_TOPO = [
    "schema", "dia", "instalacao", "batuta_versao", "modo", "rotas",
    "rotas_com_sugestao", "rotas_holdout", "braco_com", "braco_holdout",
    "vies_declarado", "skills",
  ];
  const extras = Object.keys(p).filter((k) => !CAMPOS_TOPO.includes(k));
  if (extras.length) e.push(`campo que não existe no schema: ${extras.join(", ")}`);

  return e;
}

// ======================================================================== POST

export async function POST(req: Request) {
  // database down is 503, not 500: 503 says "try again later", and the
  // client keeps the day's summary to resend (a resend replaces, it doesn't duplicate)
  if (!temBanco()) {
    return json(
      {
        ok: false,
        erro: "ingestão indisponível: o portal está sem DATABASE_URL configurada",
        acao: "guarde o resumo e reenvie depois — reenvio do mesmo dia substitui, não duplica",
      },
      503,
    );
  }

  const declarado = Number(req.headers.get("content-length") ?? "0");
  if (declarado > LIMITE_BYTES) {
    return json({ ok: false, erro: `corpo grande demais: ${declarado} bytes, limite ${LIMITE_BYTES}` }, 413);
  }

  let cru: string;
  try {
    cru = await req.text();
  } catch {
    return json({ ok: false, erro: "não deu para ler o corpo da requisição" }, 400);
  }
  // content-length lies; the real size is what counts
  if (new TextEncoder().encode(cru).length > LIMITE_BYTES) {
    return json({ ok: false, erro: `corpo grande demais: limite ${LIMITE_BYTES} bytes` }, 413);
  }

  let payload: any;
  try {
    payload = JSON.parse(cru);
  } catch (err) {
    return json({ ok: false, erro: `JSON inválido: ${(err as Error).message}` }, 400);
  }

  // FIRST gate, before the schema: if a raw event came in, nothing else matters
  const proibida = acharChaveProibida(payload);
  if (proibida) {
    return json(
      {
        ok: false,
        erro: `corpo recusado: chave proibida em ${proibida}`,
        motivo:
          "as chaves prompt, prompt_hash, turno e texto pertencem ao formato LOCAL de evento (~/.batuta/eventos.jsonl), que nunca sobe. Se elas chegaram aqui, o cliente mandou evento cru em vez do resumo diário agregado — isso é BUG DO CLIENTE e nada foi gravado.",
        conserto:
          "envie a saída de `batuta resumo --dia AAAA-MM-DD`, que é o único formato de subida (schema batuta.resumo_diario.v1)",
        reporte: "https://github.com/batuta/batuta/issues",
      },
      400,
    );
  }

  const problemas = validar(payload);
  if (problemas.length) {
    return json(
      {
        ok: false,
        erro: "corpo não bate com o schema batuta.resumo_diario.v1",
        problemas: problemas.slice(0, 25),
        total_problemas: problemas.length,
        schema: "https://batuta.space/schema/resumo-diario.schema.json",
      },
      400,
    );
  }

  // hash of the body in canonical form: it's the receipt. Whoever sent it can run
  // `batuta resumo --dia X | sha256sum` on their end and compare.
  const hash = await sha256Hex(canonico(payload));

  try {
    await sql`
      insert into batuta.instalacoes (id, versao_batuta, modo)
      values (${payload.instalacao}, ${payload.batuta_versao}, ${payload.modo})
      on conflict (id) do update set
        ultimo_visto  = now(),
        versao_batuta = excluded.versao_batuta,
        modo          = excluded.modo
    `;

    await sql`
      insert into batuta.resumos_diarios (instalacao_id, dia, payload, hash)
      values (${payload.instalacao}, ${payload.dia}::date, ${JSON.stringify(payload)}::jsonb, ${hash})
      on conflict (instalacao_id, dia) do update set
        payload     = excluded.payload,
        hash        = excluded.hash,
        recebido_em = now()
    `;

    // Rollup of the received day, immediately. It's a recalculation of the whole
    // day, not an increment — deliberately idempotent, because a resend replaces.
    // While the fleet is small this costs milliseconds; when it starts hurting,
    // the nightly batch takes over and this turns into a queue. Switching before
    // that would be optimizing in the dark.
    const r = await sql<{ linhas: number }>`
      select batuta.recalcular_metricas_dia(${payload.dia}::date) as linhas
    `;

    return json({
      ok: true,
      dia: payload.dia,
      skills: payload.skills.length,
      metricas_recalculadas: r[0]?.linhas ?? 0,
      hash,
      guardamos: "só o corpo agregado que você mandou. Sem IP, sem user agent, sem geolocalização.",
    });
  } catch (err) {
    console.error("[batuta] ingest falhou:", err);
    return json(
      {
        ok: false,
        erro: "falha ao gravar",
        acao: "reenvie depois — reenvio do mesmo dia substitui, não duplica",
      },
      500,
    );
  }
}

/**
 * POST /api/ingest — recebe UM resumo diário agregado (schema batuta.resumo_diario.v1).
 *
 * Este é o único ponto do projeto em que dado de usuário entra. Ele é escrito na
 * defensiva contra o NOSSO próprio cliente, não contra atacante: se um bug do
 * binário mandar evento cru, o estrago é irreversível — prompt hash em banco é
 * prompt hash em backup, em réplica e no dump que alguém baixou. Por isso a
 * varredura de chaves proibidas acontece ANTES da validação de schema e recusa o
 * corpo inteiro, mesmo que ele estivesse formalmente correto (§1.3, §4.5).
 *
 * O que este endpoint NÃO faz de propósito: não põe cookie, não lê IP, não guarda
 * user agent, não devolve nada que ajude a correlacionar duas instalações.
 */
import { sql, temBanco } from "../../../lib/db";
import { canonico, sha256Hex } from "../../../lib/cadeia";

// Precisa de node: o hash canônico e o driver rodam nos dois runtimes, mas a
// ingestão é caminho de escrita e a gente prefere o runtime que dá stack trace
// inteira quando algo dá errado às 3 da manhã.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 256 KB. Um dia de uso pesado dá poucos KB (~20 linhas por instalação); quem
 *  mandar mais que isso está mandando outra coisa. */
const LIMITE_BYTES = 256 * 1024;

/** Se qualquer uma destas aparecer em qualquer nível, o corpo é evento cru. */
const CHAVES_PROIBIDAS = ["prompt", "prompt_hash", "turno", "texto"];

const CORS: Record<string, string> = {
  // O binário roda na máquina de quem instalou, não num domínio nosso: não existe
  // origem para restringir. O que restringe é o método — POST e só.
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

// =========================================================== varredura de chaves

/** Percorre o corpo inteiro atrás de chave proibida. Devolve o caminho da primeira
 *  que achar. Profundidade limitada porque JSON aninhado fundo é ataque de pilha,
 *  não resumo diário. */
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

// ================================================================== validação

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
 * Validação escrita à mão. Sem ajv, sem zod: a única dependência npm do portal é o
 * driver do Neon, e um validador de 80 linhas para um schema que só nós geramos é
 * mais fácil de auditar que uma árvore de dependências. Se o schema crescer a ponto
 * de isto doer, o schema cresceu demais.
 *
 * Devolve lista de motivos legíveis — o cliente tem que conseguir consertar o bug
 * lendo a resposta, sem abrir o nosso código.
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
    // um dia de folga cobre fuso e relógio meio torto; além disso é relógio quebrado
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
  // banco fora do ar é 503 e não 500: 503 diz "tenta de novo mais tarde", e o
  // cliente guarda o resumo do dia para reenviar (o reenvio substitui, não duplica)
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
  // content-length mente; o tamanho real é o que vale
  if (new TextEncoder().encode(cru).length > LIMITE_BYTES) {
    return json({ ok: false, erro: `corpo grande demais: limite ${LIMITE_BYTES} bytes` }, 413);
  }

  let payload: any;
  try {
    payload = JSON.parse(cru);
  } catch (err) {
    return json({ ok: false, erro: `JSON inválido: ${(err as Error).message}` }, 400);
  }

  // PRIMEIRA porta, antes do schema: se veio evento cru, nada mais importa
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

  // hash do corpo em forma canônica: é o recibo. Quem enviou pode rodar
  // `batuta resumo --dia X | sha256sum` do lado dele e comparar.
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

    // Rollup do dia recebido, na hora. É recálculo do dia inteiro, não incremento —
    // idempotente de propósito, porque reenvio substitui. Enquanto a frota for
    // pequena isso custa milissegundos; quando doer, o lote noturno assume e aqui
    // vira enfileiramento. Trocar antes disso seria otimizar no escuro.
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

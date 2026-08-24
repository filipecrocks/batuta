/**
 * Portal's Neon client.
 *
 * THE RULE THAT GOVERNS THIS FILE: without `DATABASE_URL`, nothing explodes — queries
 * return an empty list. Practical reason: the portal needs to build on Vercel BEFORE
 * the database exists (and keep building when someone opens a PR preview without
 * access to Neon). Deeper reason: the ranking and recipe pages are static, generated
 * by the nightly batch; the database is a reading convenience, not a life dependency.
 * A page that shows "we don't have a number here yet" is the project's correct
 * answer — better than a 500, and better than a made-up number (§11, §14.1).
 *
 * Runs on edge and on node: @neondatabase/serverless speaks over HTTP/fetch, no
 * TCP socket. The portal's only npm dependency, and that's how it stays.
 */
import { neon } from "@neondatabase/serverless";

export type Linha = Record<string, any>;

type Consulta = <T = Linha>(
  strings: TemplateStringsArray,
  ...valores: unknown[]
) => Promise<T[]>;

let cliente: Consulta | null = null;
let resolvido = false;

/** Resolves late, not at module load: in the Vercel build the runtime env isn't
 *  there yet, and tying the module to its absence is the bug this file
 *  exists to avoid. */
function conexao(): Consulta | null {
  if (resolvido) return cliente;
  resolvido = true;
  const url = process.env.DATABASE_URL;
  if (!url) return (cliente = null);
  try {
    cliente = neon(url) as unknown as Consulta;
  } catch {
    cliente = null;
  }
  return cliente;
}

/** True when there's a database to talk to. The ingestion endpoint uses this to
 *  respond with an honest 503 instead of pretending it saved the data. */
export function temBanco(): boolean {
  return conexao() !== null;
}

/**
 * Parameterized tagged template (`sql\`select ... where dia = ${dia}\``). The values
 * become $1, $2… in the driver: there is no string-concatenation path in this
 * portal, and there isn't meant to be one.
 */
export const sql: Consulta = (<T = Linha>(
  strings: TemplateStringsArray,
  ...valores: unknown[]
): Promise<T[]> => {
  const c = conexao();
  if (!c) return Promise.resolve([] as T[]);
  return c<T>(strings, ...valores);
}) as Consulta;

/** Every page query goes through here: a database that's down doesn't take the
 *  portal down with it, it turns into an empty list and a warning in the server log. */
async function segura<T>(rotulo: string, f: () => Promise<T[]>): Promise<T[]> {
  if (!temBanco()) return [];
  try {
    return await f();
  } catch (e) {
    console.error(`[batuta] consulta "${rotulo}" falhou:`, e);
    return [];
  }
}

// ===================================================================== ranking

export type LinhaRanking = {
  skill: string;
  rotas: number;
  ativacoes: number;
  ativacoes_usuario: number;
  turnos_julgados: number;
  turnos_ok: number;
  reprompts: number;
  erros: number;
  retries: number;
  custo_usd: number;
  taxa_disparo: number | null;
  taxa_ok: number | null;
  custo_por_tarefa: number | null;
  turnos_ate_fim_mediana: number | null;
  instalacoes: number;
  dias: number;
};

/**
 * Skill ranking over a window of days.
 *
 * `minInstalacoes` isn't decoration: a row with a single installation is one
 * machine's anecdote, and publishing an anecdote as a ranking is exactly the
 * mistake the project accuses others of (§2). The default is 3 — low, but
 * explicit, and the page has to state where the cutoff was.
 */
export function rankingSkills(opcoes?: {
  dias?: number;
  limite?: number;
  minInstalacoes?: number;
}): Promise<LinhaRanking[]> {
  const dias = opcoes?.dias ?? 30;
  const limite = opcoes?.limite ?? 50;
  const minInst = opcoes?.minInstalacoes ?? 3;
  return segura("rankingSkills", () => sql<LinhaRanking>`
    select
      skill,
      sum(rotas)::bigint              as rotas,
      sum(ativacoes)::bigint          as ativacoes,
      sum(ativacoes_usuario)::bigint  as ativacoes_usuario,
      sum(turnos_julgados)::bigint    as turnos_julgados,
      sum(turnos_ok)::bigint          as turnos_ok,
      sum(reprompts)::bigint          as reprompts,
      sum(erros)::bigint              as erros,
      sum(retries)::bigint            as retries,
      sum(custo_usd)                  as custo_usd,
      case when sum(rotas) > 0
           then sum(ativacoes)::float8 / sum(rotas) end        as taxa_disparo,
      case when sum(turnos_julgados) > 0
           then sum(turnos_ok)::float8 / sum(turnos_julgados) end as taxa_ok,
      case when sum(turnos_ok) > 0
           then sum(custo_usd) / sum(turnos_ok) end            as custo_por_tarefa,
      avg(turnos_ate_fim_mediana)     as turnos_ate_fim_mediana,
      -- max, not sum: the same installation shows up on multiple days of the window,
      -- and summing would turn 1 loyal user into 30 users
      max(instalacoes)                as instalacoes,
      count(*)::int                   as dias
    from batuta.metricas_skill_dia
    where dia >= current_date - ${dias}::int
    group by skill
    having max(instalacoes) >= ${minInst}::int
    order by rotas desc, skill asc
    limit ${limite}::int
  `);
}

// ==================================================================== recipes

export type Receita = {
  slug: string;
  versao: number;
  persona: string | null;
  skills: unknown;
  evidencia: unknown;
  changelog: string | null;
  publicada_em: string;
};

/** Only the highest version of each recipe. Older ones stay in the database and
 *  remain citable by (slug, versao) — a recipe is a document, not state. */
export function receitasPublicadas(limite = 100): Promise<Receita[]> {
  return segura("receitasPublicadas", () => sql<Receita>`
    select distinct on (slug)
      slug, versao, persona, skills, evidencia, changelog, publicada_em
    from batuta.receitas
    where publicada_em is not null
    order by slug asc, versao desc
    limit ${limite}::int
  `);
}

// ====================================================================== chain

export type RegistroLinha = {
  id: number;
  tipo: string;
  corpo: unknown;
  hash: string;
  hash_anterior: string | null;
  criado_em: string;
};

/** Last links of the chain, from the top backward. It comes in descending order
 *  because that's how the page displays it; anyone verifying with `verificarCadeia`
 *  needs to reverse it (`.reverse()`) — the chain is read from the start. */
export function ultimosRegistros(limite = 20): Promise<RegistroLinha[]> {
  return segura("ultimosRegistros", () => sql<RegistroLinha>`
    select id, tipo, corpo, hash, hash_anterior, criado_em
    from batuta.registros
    order by id desc
    limit ${limite}::int
  `);
}

// ======================================================================= arena

export type TarefaArena = {
  id: number;
  enunciado_original: string;
  enunciado_canonico: string | null;
  categoria: string | null;
  complexidade: string | null;
  status: string;
  criado_em: string;
  votos: number;
};

/**
 * Arena queue with vote counts.
 *
 * Never selects `contato` (contact). The contact only serves to notify whoever
 * submitted it when the task runs; there's no reason for it to travel to a third
 * party's browser, and the cheapest way to guarantee that is for it to not be in
 * the query.
 *
 * The order is by vote, and vote orders THE QUEUE. The test result doesn't look at
 * this column (§1.6, §10).
 */
export function tarefasArena(opcoes?: {
  status?: string;
  limite?: number;
}): Promise<TarefaArena[]> {
  const status = opcoes?.status ?? null;
  const limite = opcoes?.limite ?? 50;
  return segura("tarefasArena", () => sql<TarefaArena>`
    select
      t.id,
      t.enunciado_original,
      t.enunciado_canonico,
      t.categoria,
      t.complexidade,
      t.status::text as status,
      t.criado_em,
      count(v.impressao_digital)::int as votos
    from batuta.tarefas t
    left join batuta.votos v on v.tarefa_id = t.id
    where ${status}::text is null or t.status = ${status}::batuta.status_tarefa
    group by t.id
    order by votos desc, t.criado_em desc
    limit ${limite}::int
  `);
}

/**
 * Cliente Neon do portal.
 *
 * REGRA QUE MANDA NESTE ARQUIVO: sem `DATABASE_URL`, nada explode — as consultas
 * devolvem lista vazia. Motivo prático: o portal precisa buildar na Vercel ANTES do
 * banco existir (e continuar buildando quando alguém abre um preview de PR sem
 * acesso ao Neon). Motivo de fundo: as páginas de ranking e receita são estáticas,
 * geradas pelo lote noturno; o banco é conveniência de leitura, não dependência de
 * vida. Página que mostra "ainda não temos número aqui" é a resposta certa do
 * projeto — melhor que 500, e melhor que número inventado (§11, §14.1).
 *
 * Roda em edge e em node: o @neondatabase/serverless fala por HTTP/fetch, sem
 * socket TCP. Única dependência npm do portal, e é assim que fica.
 */
import { neon } from "@neondatabase/serverless";

export type Linha = Record<string, any>;

type Consulta = <T = Linha>(
  strings: TemplateStringsArray,
  ...valores: unknown[]
) => Promise<T[]>;

let cliente: Consulta | null = null;
let resolvido = false;

/** Resolve tarde, não na carga do módulo: no build da Vercel a env de runtime
 *  ainda não está lá, e amarrar o módulo à ausência dela é o bug que este arquivo
 *  existe para evitar. */
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

/** Verdadeiro quando existe banco para falar. O endpoint de ingestão usa isto para
 *  responder 503 honesto em vez de fingir que gravou. */
export function temBanco(): boolean {
  return conexao() !== null;
}

/**
 * Tagged template parametrizado (`sql\`select ... where dia = ${dia}\``). Os valores
 * viram $1, $2… no driver: não existe caminho de concatenação de string neste
 * portal, e não é para passar a existir.
 */
export const sql: Consulta = (<T = Linha>(
  strings: TemplateStringsArray,
  ...valores: unknown[]
): Promise<T[]> => {
  const c = conexao();
  if (!c) return Promise.resolve([] as T[]);
  return c<T>(strings, ...valores);
}) as Consulta;

/** Toda consulta de página passa por aqui: banco fora do ar não derruba o portal,
 *  vira lista vazia e um aviso no log do servidor. */
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
 * Ranking de skills numa janela de dias.
 *
 * `minInstalacoes` não é enfeite: linha com uma instalação só é anedota de uma
 * máquina, e publicar anedota como ranking é exatamente o erro que o projeto acusa
 * nos outros (§2). O padrão é 3 — baixo, mas explícito, e a página tem que dizer
 * qual foi o corte.
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
      -- max e não sum: a mesma instalação aparece em vários dias da janela, e somar
      -- transformaria 1 usuário fiel em 30 usuários
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

// ==================================================================== receitas

export type Receita = {
  slug: string;
  versao: number;
  persona: string | null;
  skills: unknown;
  evidencia: unknown;
  changelog: string | null;
  publicada_em: string;
};

/** Só a versão mais alta de cada receita. As antigas continuam no banco e
 *  continuam citáveis por (slug, versao) — receita é documento, não estado. */
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

// ====================================================================== cadeia

export type RegistroLinha = {
  id: number;
  tipo: string;
  corpo: unknown;
  hash: string;
  hash_anterior: string | null;
  criado_em: string;
};

/** Últimos elos da corrente, do topo para trás. Vem em ordem decrescente porque é
 *  assim que a página mostra; quem for verificar com `verificarCadeia` precisa
 *  inverter (`.reverse()`) — a corrente se lê do começo. */
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
 * Fila da arena com contagem de votos.
 *
 * Não seleciona `contato` — nunca. O contato só serve para avisar quem enviou
 * quando a tarefa rodar; ele não tem por que trafegar até o navegador de terceiros,
 * e a forma mais barata de garantir isso é ele não estar na consulta.
 *
 * A ordem é por voto, e voto ordena A FILA. O resultado do teste não olha para esta
 * coluna (§1.6, §10).
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

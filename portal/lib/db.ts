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

export type Row = Record<string, any>;

type Query = <T = Row>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

let client: Query | null = null;
let resolved = false;

/** Resolves late, not at module load: in the Vercel build the runtime env isn't
 *  there yet, and tying the module to its absence is the bug this file
 *  exists to avoid. */
function connection(): Query | null {
  if (resolved) return client;
  resolved = true;
  const url = process.env.DATABASE_URL;
  if (!url) return (client = null);
  try {
    client = neon(url) as unknown as Query;
  } catch {
    client = null;
  }
  return client;
}

/** True when there's a database to talk to. The ingestion endpoint uses this to
 *  respond with an honest 503 instead of pretending it saved the data. */
export function hasDb(): boolean {
  return connection() !== null;
}

/** Canonical descriptive alias used by write paths; retained `hasDb` keeps API compatibility. */
export function hasDatabase(): boolean {
  return hasDb();
}

/**
 * Parameterized tagged template (`sql\`select ... where day = ${day}\``). The values
 * become $1, $2… in the driver: there is no string-concatenation path in this
 * portal, and there isn't meant to be one.
 */
export const sql: Query = (<T = Row>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> => {
  const c = connection();
  if (!c) return Promise.resolve([] as T[]);
  return c<T>(strings, ...values);
}) as Query;

/** Every page query goes through here: a database that's down doesn't take the
 *  portal down with it, it turns into an empty list and a warning in the server log. */
async function safe<T>(label: string, f: () => Promise<T[]>): Promise<T[]> {
  if (!hasDb()) return [];
  try {
    return await f();
  } catch (e) {
    console.error(`[batuta] query "${label}" failed:`, e);
    return [];
  }
}

// ===================================================================== ranking

export type RankingRow = {
  skill: string;
  routes: number;
  activations: number;
  user_activations: number;
  turns_judged: number;
  turns_ok: number;
  reprompts: number;
  errors: number;
  retries: number;
  cost_usd: number;
  trigger_rate: number | null;
  ok_rate: number | null;
  cost_per_task: number | null;
  median_turns_to_completion: number | null;
  installations: number;
  days: number;
};

/**
 * Skill ranking over a window of days.
 *
 * `minInstallations` isn't decoration: a row with a single installation is one
 * machine's anecdote, and publishing an anecdote as a ranking is exactly the
 * mistake the project accuses others of (§2). The default is 3 — low, but
 * explicit, and the page has to state where the cutoff was.
 */
export function skillRanking(options?: {
  days?: number;
  limit?: number;
  minInstallations?: number;
}): Promise<RankingRow[]> {
  const days = options?.days ?? 30;
  const limit = options?.limit ?? 50;
  const minInst = options?.minInstallations ?? 3;
  return safe("skillRanking", () => sql<RankingRow>`
    select
      skill,
      sum(routes)::bigint              as routes,
      sum(activations)::bigint         as activations,
      sum(user_activations)::bigint    as user_activations,
      sum(turns_judged)::bigint        as turns_judged,
      sum(turns_ok)::bigint            as turns_ok,
      sum(reprompts)::bigint           as reprompts,
      sum(errors)::bigint              as errors,
      sum(retries)::bigint             as retries,
      sum(cost_usd)                    as cost_usd,
      case when sum(routes) > 0
           then sum(activations)::float8 / sum(routes) end        as trigger_rate,
      case when sum(turns_judged) > 0
           then sum(turns_ok)::float8 / sum(turns_judged) end as ok_rate,
      case when sum(turns_ok) > 0
           then sum(cost_usd) / sum(turns_ok) end            as cost_per_task,
      avg(median_turns_to_completion)  as median_turns_to_completion,
      -- max, not sum: the same installation shows up on multiple days of the window,
      -- and summing would turn 1 loyal user into 30 users
      max(installations)               as installations,
      count(*)::int                    as days
    from batuta.skill_day_metrics
    where day >= current_date - ${days}::int
    group by skill
    having max(installations) >= ${minInst}::int
    order by routes desc, skill asc
    limit ${limit}::int
  `);
}

// ==================================================================== recipes

export type Recipe = {
  slug: string;
  version: number;
  persona: string | null;
  skills: unknown;
  evidence: unknown;
  changelog: string | null;
  published_at: string;
};

/** Only the highest version of each recipe. Older ones stay in the database and
 *  remain citable by (slug, version) — a recipe is a document, not state. */
export function publishedRecipes(limit = 100): Promise<Recipe[]> {
  return safe("publishedRecipes", () => sql<Recipe>`
    select distinct on (slug)
      slug, version, persona, skills, evidence, changelog, published_at
    from batuta.recipes
    where published_at is not null
    order by slug asc, version desc
    limit ${limit}::int
  `);
}

// ====================================================================== chain

export type RecordRow = {
  id: number;
  type: string;
  body: unknown;
  hash: string;
  previous_hash: string | null;
  created_at: string;
};

/** Last links of the chain, from the top backward. It comes in descending order
 *  because that's how the page displays it; anyone verifying with `verifyChain`
 *  needs to reverse it (`.reverse()`) — the chain is read from the start. */
export function latestRecords(limit = 20): Promise<RecordRow[]> {
  return safe("latestRecords", () => sql<RecordRow>`
    select id, type, body, hash, previous_hash, created_at
    from batuta.records
    order by id desc
    limit ${limit}::int
  `);
}

// ======================================================================= arena

export type ArenaTask = {
  id: number;
  original_statement: string;
  canonical_statement: string | null;
  category: string | null;
  complexity: string | null;
  status: string;
  created_at: string;
  votes: number;
};

/**
 * Arena queue with vote counts.
 *
 * Never selects `contact`. The contact only serves to notify whoever
 * submitted it when the task runs; there's no reason for it to travel to a third
 * party's browser, and the cheapest way to guarantee that is for it to not be in
 * the query.
 *
 * The order is by vote, and vote orders THE QUEUE. The test result doesn't look at
 * this column (§1.6, §10).
 */
export function arenaTasks(options?: {
  status?: string;
  limit?: number;
}): Promise<ArenaTask[]> {
  const status = options?.status ?? null;
  const limit = options?.limit ?? 50;
  return safe("arenaTasks", () => sql<ArenaTask>`
    select
      t.id,
      t.original_statement,
      t.canonical_statement,
      t.category,
      t.complexity,
      t.status::text as status,
      t.created_at,
      count(v.fingerprint)::int as votes
    from batuta.tasks t
    left join batuta.votes v on v.task_id = t.id
    where ${status}::text is null or t.status = ${status}::batuta.task_status
    group by t.id
    order by votes desc, t.created_at desc
    limit ${limit}::int
  `);
}

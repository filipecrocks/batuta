-- BATUTA — initial schema (Postgres 16 / Neon)
--
-- This database is a READ CACHE, not the source of truth. The truth is the public
-- git repository (protocol, battery, raw results) plus the hash chain of
-- records/, timestamped outside our control by OpenTimestamps (§8). If this
-- database were lost entirely, it can be rebuilt from the files; if it were
-- tampered with, the hash chain gives it away. That's why nothing stored here
-- can't be republished in public tomorrow morning.
--
-- Apply with:  psql "$DATABASE_URL" -f sql/001_initial.sql

begin;

create schema if not exists batuta;

-- =========================================================================
-- FLEET
-- =========================================================================

-- One row per installation of the binary. The id arrives READY from the client: it's
-- sha256('installation|' || local_salt)[..16], derived from a salt that never leaves
-- the machine (home::installation_id). The server doesn't generate it, doesn't
-- verify it, and can't reverse it — it only serves to say "these rows came from
-- the same machine".
--
-- DOES NOT EXIST, ON PURPOSE: an IP column, user agent, country, timezone,
-- hostname, or email. This isn't an oversight or "left for later". Data that isn't
-- collected doesn't leak, can't be subpoenaed, doesn't get sold along in an
-- acquisition, and doesn't change its mind when the leadership changes. Batuta's
-- only product is credibility (§14.1); keeping IP "to better understand geographic
-- distribution" would cost more than any chart it could produce. Whoever operates
-- the ingest also has to make sure the provider's access log doesn't keep IP
-- alongside the body — the schema here only covers our half.
create table if not exists batuta.installations (
  id            text        primary key,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  batuta_version text,
  mode          text,
  constraint installations_id_format check (id ~ '^[0-9a-f]{16}$')
);

comment on table  batuta.installations is 'Fleet. No IP, no user agent, no geolocation — see the comment in the DDL.';
comment on column batuta.installations.mode is 'local (hook, complete funnel) or degraded (MCP/skill, incomplete funnel). Travels with the number because it changes what the number means.';

-- The raw body the installation sent, stored as received. Storing the whole
-- payload in jsonb is what allows recomputing the rollup later after an
-- aggregation bug without asking the fleet for anything back.
--
-- RESENDING THE SAME DAY REPLACES, IT DOES NOT DUPLICATE: the primary key is
-- (installation_id, day). The client can send the day's summary at 2pm and again
-- at 11pm once the day is closed; the second version is the good one. Without
-- this, every network retry would become a new user in the ranking.
create table if not exists batuta.daily_summaries (
  installation_id text        not null references batuta.installations(id) on delete cascade,
  day             date        not null,
  payload         jsonb       not null,
  received_at     timestamptz not null default now(),
  hash            text        not null,
  -- the composite PK IS the UNIQUE(installation_id, day) required by the ingestion protocol
  primary key (installation_id, day)
);

comment on column batuta.daily_summaries.hash is 'sha256 of the payload in canonical JSON (alphabetical keys, no spaces — same as Rust''s json::write). Lets the sender verify that what arrived is byte for byte what they sent.';

create index if not exists daily_summaries_day_idx        on batuta.daily_summaries (day desc);
create index if not exists daily_summaries_received_idx   on batuta.daily_summaries (received_at desc);

-- =========================================================================
-- ROLLUP — the only table the static pages read
-- =========================================================================

-- The nightly batch (and the ingest itself, for the day just received) rewrites
-- this from daily_summaries. It's derived: it can be dropped entirely and
-- rebuilt. Deliberately denormalized, because the page is static and the query
-- has to be a dumb SELECT with no join.
create table if not exists batuta.skill_day_metrics (
  skill                      text        not null,
  day                        date        not null,
  routes                     bigint      not null default 0,
  activations                bigint      not null default 0,
  user_activations           bigint      not null default 0,
  turns_judged               bigint      not null default 0,
  turns_ok                   bigint      not null default 0,
  reprompts                  bigint      not null default 0,
  errors                     bigint      not null default 0,
  retries                    bigint      not null default 0,
  tokens_in                  double precision not null default 0,
  tokens_out                 double precision not null default 0,
  cost_usd                   numeric(16,6)    not null default 0,
  median_turns_to_completion double precision,
  -- how many distinct installations went into this row. It's the sample's n: a
  -- rate without n isn't published, and a row with installations=1 is an
  -- anecdote, not a measurement.
  installations              integer     not null default 0,
  updated_at                 timestamptz not null default now(),
  primary key (skill, day)
);

comment on column batuta.skill_day_metrics.cost_usd is 'numeric, not float: money summed in float accumulates error, and the project''s whole headline is cost per completed task.';
comment on column batuta.skill_day_metrics.median_turns_to_completion is 'Median of medians per installation — an assumed approximation. The exact median would require uploading the distribution, and a per-turn distribution is a raw event in disguise (§4.5).';

create index if not exists skill_day_metrics_day_idx   on batuta.skill_day_metrics (day desc);
create index if not exists skill_day_metrics_skill_idx on batuta.skill_day_metrics (skill, day desc);

-- =========================================================================
-- SKILLS CATALOG
-- =========================================================================

-- Record of a skill seen, not redistribution. A skill without a clear license
-- doesn't make it into the kit: it becomes an installer that points to the
-- source instead (§4.6). license_verified is an assertion from someone who
-- opened the LICENSE file, not from a scraper that read a badge.
create table if not exists batuta.skills (
  slug             text        primary key,
  name             text        not null,
  source_url       text,
  license          text,
  license_verified boolean     not null default false,
  first_seen       timestamptz not null default now()
);

-- short, heavily queried list: "what's still without a verified license?"
create index if not exists skills_license_pending_idx
  on batuta.skills (slug) where license_verified = false;

-- =========================================================================
-- ARENA
-- =========================================================================

-- CREATE TYPE doesn't accept IF NOT EXISTS; the DO block keeps the file re-runnable.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'task_status' and n.nspname = 'batuta'
  ) then
    create type batuta.task_status as enum (
      'screening',   -- arrived, nobody has looked yet
      'rejected',    -- hidden executable, out of scope, spam
      'duplicate',   -- an equivalent task already exists
      'canonized',   -- rewritten as a statement + acceptance criteria
      'queued',      -- canonized and voted on, waiting for a round
      'running',
      'published'
    );
  end if;
end
$$;

-- A SUBMITTED TASK NEVER RUNS AS SENT (§10). original_statement is what the
-- person wrote and stays untouched for auditing; canonical_statement is what
-- the battery runs, and starts out NULL — nobody skips canonization out of a
-- rush. Whoever submits suggests the problem; the rules belong to Batuta.
-- Without this gate, a skill author would send exactly the task their skill
-- wins at and the ranking would turn into a showcase.
create table if not exists batuta.tasks (
  id                   bigint generated always as identity primary key,
  original_statement   text        not null,
  canonical_statement  text,
  acceptance_criteria  jsonb,
  category             text,
  complexity           text,
  status               batuta.task_status not null default 'screening',
  source               text        not null default 'public',
  -- contact is optional and serves one purpose only: notifying whoever submitted
  -- the task when it runs. It doesn't become a mailing list, a newsletter, or a login.
  contact              text,
  created_at           timestamptz not null default now(),
  constraint tasks_category_ck check (
    category is null or category in ('code','writing','data','documents','research','automation')
  ),
  constraint tasks_complexity_ck check (
    complexity is null or complexity in ('simple','medium','complex')
  ),
  -- status only advances past canonization if a canonical statement and
  -- acceptance criteria both exist. The database enforces the rule that a rush
  -- would otherwise break.
  constraint tasks_canonized_ck check (
    status in ('screening','rejected','duplicate')
    or (canonical_statement is not null and acceptance_criteria is not null)
  )
);

create index if not exists tasks_status_idx on batuta.tasks (status, created_at desc);

-- A VOTE DECIDES THE QUEUE, NEVER THE RESULT (§1.6). This table has no rating
-- column, no star, no "like" — on purpose: if someone ever wants to fold votes
-- into the ranking, they'll have to change the schema in public. fingerprint
-- is a weak browser fingerprint (enough to get in the way of a repeat vote, far
-- from enough to identify anyone), which is why the UNIQUE constraint is
-- anti-noise, not anti-fraud. Popularity is marketing; the ruler is a measured
-- outcome (§14.4).
create table if not exists batuta.votes (
  task_id     bigint      not null references batuta.tasks(id) on delete cascade,
  fingerprint text        not null,
  created_at  timestamptz not null default now(),
  primary key (task_id, fingerprint)
);

-- =========================================================================
-- ROUNDS (test matrix, §7)
-- =========================================================================

create table if not exists batuta.rounds (
  id               bigint generated always as identity primary key,
  task_id          bigint references batuta.tasks(id) on delete set null,
  model            text        not null,
  -- channel doesn't multiply the main matrix (§7.2): the matrix runs on a single
  -- channel, and comparing across channels is a separate experiment. The column
  -- exists so that comparison is possible, not to become an axis by accident.
  channel          text        not null,
  arm              text        not null,
  recipe_slug      text,
  cost_usd         numeric(16,6),
  tokens           bigint,
  turns            integer,
  verdict          text,
  judge_model      text,
  judge_version    text,
  judge_prompt_hash text,
  -- URL of the published raw data: prompt, both arms' outputs, verdict. Publishing
  -- the raw data is what sets Batuta apart from a self-proclaimed README (§9.5).
  raw_url          text,
  created_at       timestamptz not null default now(),
  constraint rounds_arm_ck check (arm in ('none','skill','recipe')),
  constraint rounds_recipe_ck check (arm <> 'recipe' or recipe_slug is not null),
  constraint rounds_verdict_ck check (verdict is null or verdict in ('ok','failed','inconclusive')),
  -- THE JUDGE IS NOT THE DEFENDANT (§6.2): a model never judges its own output.
  -- Cross judging is a rule of the protocol, so it's a constraint, not a convention.
  constraint rounds_cross_judge_ck check (judge_model is null or judge_model <> model),
  -- a judge without a version and without a prompt hash invalidates the historical series (§6.3)
  constraint rounds_judge_versioned_ck check (
    judge_model is null or (judge_version is not null and judge_prompt_hash is not null)
  )
);

create index if not exists rounds_task_idx   on batuta.rounds (task_id, created_at desc);
create index if not exists rounds_model_idx  on batuta.rounds (model, created_at desc);
create index if not exists rounds_recipe_idx on batuta.rounds (recipe_slug) where recipe_slug is not null;

-- =========================================================================
-- RECIPES (§5)
-- =========================================================================

-- A recipe is citable and comparable, so the version is part of its identity:
-- 'beginner v3' doesn't overwrite 'beginner v2', it coexists with it. Whoever
-- cited v2 in a report can still open exactly what they cited.
create table if not exists batuta.recipes (
  slug          text    not null,
  version       integer not null,
  persona       text,
  skills        jsonb   not null default '[]'::jsonb,
  evidence      jsonb   not null default '{}'::jsonb,
  changelog     text,
  published_at  timestamptz,
  primary key (slug, version),
  constraint recipes_version_ck check (version >= 1),
  -- only what the test approved goes into the recipe: publishing without an
  -- attached evidence block is exactly what this project exists to prevent
  constraint recipes_evidence_ck check (published_at is null or evidence <> '{}'::jsonb)
);

comment on column batuta.recipes.skills is 'List of {slug, version} — skills PINNED to a version. A recipe that points to "the latest" isn''t reproducible.';

create index if not exists recipes_published_idx on batuta.recipes (published_at desc) where published_at is not null;

-- =========================================================================
-- HASH CHAIN (§8)
-- =========================================================================

-- Database mirror of the repository's records/ folder. bigserial, not identity,
-- because the id order IS the chain's order and needs to be trivial to read.
-- The protections (immutability and verification) live in sql/002_chain.sql.
create table if not exists batuta.records (
  id             bigserial   primary key,
  type           text        not null,
  body           jsonb       not null,
  hash           text        not null unique,
  -- NULL only at genesis; from then on it's the previous record's hash
  previous_hash  text,
  created_at     timestamptz not null default now(),
  constraint records_hash_ck          check (hash ~ '^[0-9a-f]{64}$'),
  constraint records_previous_hash_ck check (previous_hash is null or previous_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists records_created_idx on batuta.records (created_at desc);
create index if not exists records_type_idx   on batuta.records (type, id desc);
-- the RAG only answers with what's published, and every answer comes with a
-- link + hash (§11): searching inside the body is a hot path for the portal, so
-- it gets an index
create index if not exists records_body_gin  on batuta.records using gin (body jsonb_path_ops);

-- =========================================================================
-- CONTRIBUTORS — credit is the salary (§1.1)
-- =========================================================================

-- Zero profit, always. Nobody gets paid; the name on the portal and in the
-- dataset is the payment, which is why this table is infrastructure, not
-- decoration: it's the only form of retention the project can offer (§14.2).
create table if not exists batuta.contributors (
  id    bigint generated always as identity primary key,
  name  text not null unique,
  role  text,
  url   text,
  since date not null default current_date
);

-- =========================================================================
-- ROLLUP: daily_summaries -> skill_day_metrics
-- =========================================================================

-- Recomputes the whole day from scratch instead of summing incrementally. It's
-- more expensive and it's the right call: resending replaces (the PK guarantees
-- it), so summing an increment would duplicate the day for anyone who sent
-- twice. Idempotent by construction — can run as many times as needed, the
-- result is the same.
create or replace function batuta.recalculate_day_metrics(p_day date)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  delete from batuta.skill_day_metrics where day = p_day;

  with rows as (
    select
      r.installation_id,
      s->>'skill'                                                as skill,
      coalesce((s->>'routes')::numeric, 0)                       as routes,
      coalesce((s->>'activations')::numeric, 0)                  as activations,
      coalesce((s->>'user_activations')::numeric, 0)             as user_activations,
      coalesce((s->>'turns_judged')::numeric, 0)                 as turns_judged,
      coalesce((s->>'turns_ok')::numeric, 0)                     as turns_ok,
      coalesce((s->>'reprompts')::numeric, 0)                    as reprompts,
      coalesce((s->>'errors')::numeric, 0)                       as errors,
      coalesce((s->>'retries')::numeric, 0)                      as retries,
      coalesce((s->>'tokens_in')::double precision, 0)           as tokens_in,
      coalesce((s->>'tokens_out')::double precision, 0)          as tokens_out,
      coalesce((s->>'cost_usd')::numeric, 0)                     as cost_usd,
      coalesce((s->>'median_turns_to_completion')::double precision, 0) as median
    from batuta.daily_summaries r
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.payload->'skills') = 'array'
           then r.payload->'skills'
           else '[]'::jsonb end
    ) as s
    where r.day = p_day
      and coalesce(s->>'skill', '') <> ''
  )
  insert into batuta.skill_day_metrics (
    skill, day, routes, activations, user_activations, turns_judged, turns_ok,
    reprompts, errors, retries, tokens_in, tokens_out, cost_usd,
    median_turns_to_completion, installations, updated_at
  )
  select
    skill,
    p_day,
    sum(routes)::bigint,
    sum(activations)::bigint,
    sum(user_activations)::bigint,
    sum(turns_judged)::bigint,
    sum(turns_ok)::bigint,
    sum(reprompts)::bigint,
    sum(errors)::bigint,
    sum(retries)::bigint,
    sum(tokens_in),
    sum(tokens_out),
    sum(cost_usd),
    -- median only among those who measured: an installation with no completed
    -- turn would enter as 0 and pull the number down without having measured
    -- anything
    percentile_cont(0.5) within group (order by median) filter (where median > 0),
    count(distinct installation_id)::integer,
    now()
  from rows
  group by skill;

  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function batuta.recalculate_day_metrics(date) is 'Idempotent: deletes the day and rewrites it. Called by the ingest for the day just received and by the nightly batch for the whole window.';

commit;

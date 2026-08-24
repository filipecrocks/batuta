-- BATUTA — initial schema (Postgres 16 / Neon)
--
-- This database is a READ CACHE, not the source of truth. The truth is the public
-- git repository (protocol, battery, raw results) plus the hash chain of
-- registros/, timestamped outside our control by OpenTimestamps (§8). If this
-- database were lost entirely, it can be rebuilt from the files; if it were
-- tampered with, the hash chain gives it away. That's why nothing stored here
-- can't be republished in public tomorrow morning.
--
-- Apply with:  psql "$DATABASE_URL" -f sql/001_inicial.sql

begin;

create schema if not exists batuta;

-- =========================================================================
-- FLEET
-- =========================================================================

-- One row per installation of the binary. The id arrives READY from the client: it's
-- sha256('instalacao|' || sal_local)[..16], derived from a salt that never leaves the
-- machine (casa::id_instalacao). The server doesn't generate it, doesn't verify it,
-- and can't reverse it — it only serves to say "these rows came from the same
-- machine".
--
-- DOES NOT EXIST, ON PURPOSE: an IP column, user agent, country, timezone,
-- hostname, or email. This isn't an oversight or "left for later". Data that isn't
-- collected doesn't leak, can't be subpoenaed, doesn't get sold along in an
-- acquisition, and doesn't change its mind when the leadership changes. Batuta's
-- only product is credibility (§14.1); keeping IP "to better understand geographic
-- distribution" would cost more than any chart it could produce. Whoever operates
-- the ingest also has to make sure the provider's access log doesn't keep IP
-- alongside the body — the schema here only covers our half.
create table if not exists batuta.instalacoes (
  id             text        primary key,
  primeiro_visto timestamptz not null default now(),
  ultimo_visto   timestamptz not null default now(),
  versao_batuta  text,
  modo           text,
  constraint instalacoes_id_formato check (id ~ '^[0-9a-f]{16}$')
);

comment on table  batuta.instalacoes is 'Fleet. No IP, no user agent, no geolocation — see the comment in the DDL.';
comment on column batuta.instalacoes.modo is 'local (hook, complete funnel) or degradado (MCP/skill, incomplete funnel). Travels with the number because it changes what the number means.';

-- The raw body the installation sent, stored as received. Storing the whole
-- payload in jsonb is what allows recomputing the rollup later after an
-- aggregation bug without asking the fleet for anything back.
--
-- RESENDING THE SAME DAY REPLACES, IT DOES NOT DUPLICATE: the primary key is
-- (instalacao_id, dia). The client can send the day's summary at 2pm and again at
-- 11pm once the day is closed; the second version is the good one. Without this,
-- every network retry would become a new user in the ranking.
create table if not exists batuta.resumos_diarios (
  instalacao_id text        not null references batuta.instalacoes(id) on delete cascade,
  dia           date        not null,
  payload       jsonb       not null,
  recebido_em   timestamptz not null default now(),
  hash          text        not null,
  -- the composite PK IS the UNIQUE(instalacao_id, dia) required by the ingestion protocol
  primary key (instalacao_id, dia)
);

comment on column batuta.resumos_diarios.hash is 'sha256 of the payload in canonical JSON (alphabetical keys, no spaces — same as Rust''s json::escrever). Lets the sender verify that what arrived is byte for byte what they sent.';

create index if not exists resumos_diarios_dia_idx        on batuta.resumos_diarios (dia desc);
create index if not exists resumos_diarios_recebido_idx   on batuta.resumos_diarios (recebido_em desc);

-- =========================================================================
-- ROLLUP — the only table the static pages read
-- =========================================================================

-- The nightly batch (and the ingest itself, for the day just received) rewrites
-- this from resumos_diarios. It's derived: it can be dropped entirely and
-- rebuilt. Deliberately denormalized, because the page is static and the query
-- has to be a dumb SELECT with no join.
create table if not exists batuta.metricas_skill_dia (
  skill                  text        not null,
  dia                    date        not null,
  rotas                  bigint      not null default 0,
  ativacoes              bigint      not null default 0,
  ativacoes_usuario      bigint      not null default 0,
  turnos_julgados        bigint      not null default 0,
  turnos_ok              bigint      not null default 0,
  reprompts              bigint      not null default 0,
  erros                  bigint      not null default 0,
  retries                bigint      not null default 0,
  tokens_in              double precision not null default 0,
  tokens_out             double precision not null default 0,
  custo_usd              numeric(16,6)    not null default 0,
  turnos_ate_fim_mediana double precision,
  -- how many distinct installations went into this row. It's the sample's n: a
  -- rate without n isn't published, and a row with instalacoes=1 is an anecdote,
  -- not a measurement.
  instalacoes            integer     not null default 0,
  atualizado_em          timestamptz not null default now(),
  primary key (skill, dia)
);

comment on column batuta.metricas_skill_dia.custo_usd is 'numeric, not float: money summed in float accumulates error, and the project''s whole headline is cost per completed task.';
comment on column batuta.metricas_skill_dia.turnos_ate_fim_mediana is 'Median of medians per installation — an assumed approximation. The exact median would require uploading the distribution, and a per-turn distribution is a raw event in disguise (§4.5).';

create index if not exists metricas_skill_dia_dia_idx   on batuta.metricas_skill_dia (dia desc);
create index if not exists metricas_skill_dia_skill_idx on batuta.metricas_skill_dia (skill, dia desc);

-- =========================================================================
-- SKILLS CATALOG
-- =========================================================================

-- Record of a skill seen, not redistribution. A skill without a clear license
-- doesn't make it into the kit: it becomes an installer that points to the
-- source instead (§4.6). licenca_verificada is an assertion from someone who
-- opened the LICENSE file, not from a scraper that read a badge.
create table if not exists batuta.skills (
  slug               text        primary key,
  nome               text        not null,
  fonte_url          text,
  licenca            text,
  licenca_verificada boolean     not null default false,
  primeira_vista     timestamptz not null default now()
);

-- short, heavily queried list: "what's still without a verified license?"
create index if not exists skills_licenca_pendente_idx
  on batuta.skills (slug) where licenca_verificada = false;

-- =========================================================================
-- ARENA
-- =========================================================================

-- CREATE TYPE doesn't accept IF NOT EXISTS; the DO block keeps the file re-runnable.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'status_tarefa' and n.nspname = 'batuta'
  ) then
    create type batuta.status_tarefa as enum (
      'triagem',     -- arrived, nobody has looked yet
      'recusada',    -- hidden executable, out of scope, spam
      'duplicada',   -- an equivalent task already exists
      'canonizada',  -- rewritten as a statement + acceptance criteria
      'fila',        -- canonized and voted on, waiting for a round
      'rodando',
      'publicada'
    );
  end if;
end
$$;

-- A SUBMITTED TASK NEVER RUNS AS SENT (§10). enunciado_original is what the person
-- wrote and stays untouched for auditing; enunciado_canonico is what the battery
-- runs, and starts out NULL — nobody skips canonization out of a rush. Whoever
-- submits suggests the problem; the rules belong to Batuta. Without this gate, a
-- skill author would send exactly the task their skill wins at and the ranking
-- would turn into a showcase.
create table if not exists batuta.tarefas (
  id                 bigint generated always as identity primary key,
  enunciado_original text        not null,
  enunciado_canonico text,
  criterio_aceite    jsonb,
  categoria          text,
  complexidade       text,
  status             batuta.status_tarefa not null default 'triagem',
  origem             text        not null default 'publico',
  -- contact is optional and serves one purpose only: notifying whoever submitted
  -- the task when it runs. It doesn't become a mailing list, a newsletter, or a login.
  contato            text,
  criado_em          timestamptz not null default now(),
  constraint tarefas_categoria_ck check (
    categoria is null or categoria in ('codigo','escrita','dados','documentos','pesquisa','automacao')
  ),
  constraint tarefas_complexidade_ck check (
    complexidade is null or complexidade in ('simples','media','complexa')
  ),
  -- status only advances past canonization if a canonical statement and
  -- acceptance criteria both exist. The database enforces the rule that a rush
  -- would otherwise break.
  constraint tarefas_canonizada_ck check (
    status in ('triagem','recusada','duplicada')
    or (enunciado_canonico is not null and criterio_aceite is not null)
  )
);

create index if not exists tarefas_status_idx on batuta.tarefas (status, criado_em desc);

-- A VOTE DECIDES THE QUEUE, NEVER THE RESULT (§1.6). This table has no rating
-- column, no star, no "like" — on purpose: if someone ever wants to fold votes
-- into the ranking, they'll have to change the schema in public. impressao_digital
-- is a weak browser fingerprint (enough to get in the way of a repeat vote, far
-- from enough to identify anyone), which is why the UNIQUE constraint is
-- anti-noise, not anti-fraud. Popularity is marketing; the ruler is a measured
-- outcome (§14.4).
create table if not exists batuta.votos (
  tarefa_id        bigint      not null references batuta.tarefas(id) on delete cascade,
  impressao_digital text       not null,
  criado_em        timestamptz not null default now(),
  primary key (tarefa_id, impressao_digital)
);

-- =========================================================================
-- ROUNDS (test matrix, §7)
-- =========================================================================

create table if not exists batuta.rodadas (
  id              bigint generated always as identity primary key,
  tarefa_id       bigint references batuta.tarefas(id) on delete set null,
  modelo          text        not null,
  -- canal doesn't multiply the main matrix (§7.2): the matrix runs on a single
  -- channel, and comparing across channels is a separate experiment. The column
  -- exists so that comparison is possible, not to become an axis by accident.
  canal           text        not null,
  braco           text        not null,
  receita_slug    text,
  custo_usd       numeric(16,6),
  tokens          bigint,
  turnos          integer,
  veredito        text,
  juiz_modelo     text,
  juiz_versao     text,
  juiz_prompt_hash text,
  -- URL of the published raw data: prompt, both arms' outputs, verdict. Publishing
  -- the raw data is what sets Batuta apart from a self-proclaimed README (§9.5).
  bruto_url       text,
  criado_em       timestamptz not null default now(),
  constraint rodadas_braco_ck check (braco in ('sem','skill','receita')),
  constraint rodadas_receita_ck check (braco <> 'receita' or receita_slug is not null),
  constraint rodadas_veredito_ck check (veredito is null or veredito in ('ok','falhou','inconclusivo')),
  -- THE JUDGE IS NOT THE DEFENDANT (§6.2): a model never judges its own output.
  -- Cross judging is a rule of the protocol, so it's a constraint, not a convention.
  constraint rodadas_juiz_cruzado_ck check (juiz_modelo is null or juiz_modelo <> modelo),
  -- a judge without a version and without a prompt hash invalidates the historical series (§6.3)
  constraint rodadas_juiz_versionado_ck check (
    juiz_modelo is null or (juiz_versao is not null and juiz_prompt_hash is not null)
  )
);

create index if not exists rodadas_tarefa_idx  on batuta.rodadas (tarefa_id, criado_em desc);
create index if not exists rodadas_modelo_idx  on batuta.rodadas (modelo, criado_em desc);
create index if not exists rodadas_receita_idx on batuta.rodadas (receita_slug) where receita_slug is not null;

-- =========================================================================
-- RECIPES (§5)
-- =========================================================================

-- A recipe is citable and comparable, so the version is part of its identity:
-- 'iniciante v3' doesn't overwrite 'iniciante v2', it coexists with it. Whoever
-- cited v2 in a report can still open exactly what they cited.
create table if not exists batuta.receitas (
  slug         text    not null,
  versao       integer not null,
  persona      text,
  skills       jsonb   not null default '[]'::jsonb,
  evidencia    jsonb   not null default '{}'::jsonb,
  changelog    text,
  publicada_em timestamptz,
  primary key (slug, versao),
  constraint receitas_versao_ck check (versao >= 1),
  -- only what the test approved goes into the recipe: publishing without an
  -- attached evidence block is exactly what this project exists to prevent
  constraint receitas_evidencia_ck check (publicada_em is null or evidencia <> '{}'::jsonb)
);

comment on column batuta.receitas.skills is 'List of {slug, versao} — skills PINNED to a version. A recipe that points to "the latest" isn''t reproducible.';

create index if not exists receitas_publicadas_idx on batuta.receitas (publicada_em desc) where publicada_em is not null;

-- =========================================================================
-- HASH CHAIN (§8)
-- =========================================================================

-- Database mirror of the repository's registros/ folder. bigserial, not identity,
-- because the id order IS the chain's order and needs to be trivial to read.
-- The protections (immutability and verification) live in sql/002_cadeia.sql.
create table if not exists batuta.registros (
  id             bigserial   primary key,
  tipo           text        not null,
  corpo          jsonb       not null,
  hash           text        not null unique,
  -- NULL only at genesis; from then on it's the previous record's hash
  hash_anterior  text,
  criado_em      timestamptz not null default now(),
  constraint registros_hash_ck          check (hash ~ '^[0-9a-f]{64}$'),
  constraint registros_hash_anterior_ck check (hash_anterior is null or hash_anterior ~ '^[0-9a-f]{64}$')
);

create index if not exists registros_criado_idx on batuta.registros (criado_em desc);
create index if not exists registros_tipo_idx   on batuta.registros (tipo, id desc);
-- the RAG only answers with what's published, and every answer comes with a
-- link + hash (§11): searching inside the body is a hot path for the portal, so
-- it gets an index
create index if not exists registros_corpo_gin  on batuta.registros using gin (corpo jsonb_path_ops);

-- =========================================================================
-- CONTRIBUTORS — credit is the salary (§1.1)
-- =========================================================================

-- Zero profit, always. Nobody gets paid; the name on the portal and in the
-- dataset is the payment, which is why this table is infrastructure, not
-- decoration: it's the only form of retention the project can offer (§14.2).
create table if not exists batuta.colaboradores (
  id    bigint generated always as identity primary key,
  nome  text not null unique,
  papel text,
  url   text,
  desde date not null default current_date
);

-- =========================================================================
-- ROLLUP: resumos_diarios -> metricas_skill_dia
-- =========================================================================

-- Recomputes the whole day from scratch instead of summing incrementally. It's
-- more expensive and it's the right call: resending replaces (the PK guarantees
-- it), so summing an increment would duplicate the day for anyone who sent
-- twice. Idempotent by construction — can run as many times as needed, the
-- result is the same.
create or replace function batuta.recalcular_metricas_dia(p_dia date)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  delete from batuta.metricas_skill_dia where dia = p_dia;

  with linhas as (
    select
      r.instalacao_id,
      s->>'skill'                                                as skill,
      coalesce((s->>'rotas')::numeric, 0)                        as rotas,
      coalesce((s->>'ativacoes')::numeric, 0)                    as ativacoes,
      coalesce((s->>'ativacoes_usuario')::numeric, 0)            as ativacoes_usuario,
      coalesce((s->>'turnos_julgados')::numeric, 0)              as turnos_julgados,
      coalesce((s->>'turnos_ok')::numeric, 0)                    as turnos_ok,
      coalesce((s->>'reprompts')::numeric, 0)                    as reprompts,
      coalesce((s->>'erros')::numeric, 0)                        as erros,
      coalesce((s->>'retries')::numeric, 0)                      as retries,
      coalesce((s->>'tokens_in')::double precision, 0)           as tokens_in,
      coalesce((s->>'tokens_out')::double precision, 0)          as tokens_out,
      coalesce((s->>'custo_usd')::numeric, 0)                    as custo_usd,
      coalesce((s->>'turnos_ate_fim_mediana')::double precision, 0) as mediana
    from batuta.resumos_diarios r
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.payload->'skills') = 'array'
           then r.payload->'skills'
           else '[]'::jsonb end
    ) as s
    where r.dia = p_dia
      and coalesce(s->>'skill', '') <> ''
  )
  insert into batuta.metricas_skill_dia (
    skill, dia, rotas, ativacoes, ativacoes_usuario, turnos_julgados, turnos_ok,
    reprompts, erros, retries, tokens_in, tokens_out, custo_usd,
    turnos_ate_fim_mediana, instalacoes, atualizado_em
  )
  select
    skill,
    p_dia,
    sum(rotas)::bigint,
    sum(ativacoes)::bigint,
    sum(ativacoes_usuario)::bigint,
    sum(turnos_julgados)::bigint,
    sum(turnos_ok)::bigint,
    sum(reprompts)::bigint,
    sum(erros)::bigint,
    sum(retries)::bigint,
    sum(tokens_in),
    sum(tokens_out),
    sum(custo_usd),
    -- median only among those who measured: an installation with no completed
    -- turn would enter as 0 and pull the number down without having measured
    -- anything
    percentile_cont(0.5) within group (order by mediana) filter (where mediana > 0),
    count(distinct instalacao_id)::integer,
    now()
  from linhas
  group by skill;

  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function batuta.recalcular_metricas_dia(date) is 'Idempotent: deletes the day and rewrites it. Called by the ingest for the day just received and by the nightly batch for the whole window.';

commit;

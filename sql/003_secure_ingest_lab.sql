-- Authenticated, replay-safe ingestion and the LAB -> Batuta event contract.
-- PostgreSQL 16 / Neon. Safe to re-run. No table is dropped or rewritten.

begin;

create table if not exists batuta.ingest_idempotency (
  signer_key_id   text        not null,
  idempotency_key text        not null,
  request_kind    text        not null,
  request_hash    text        not null,
  status          text        not null default 'in_progress',
  response_body   jsonb,
  http_status     integer,
  created_at      timestamptz not null default clock_timestamp(),
  updated_at      timestamptz not null default clock_timestamp(),
  primary key (signer_key_id, idempotency_key),
  constraint ingest_idempotency_key_id_ck check (signer_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  constraint ingest_idempotency_key_ck check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{7,159}$'),
  constraint ingest_idempotency_kind_ck check (request_kind in ('daily_summary', 'lab_event')),
  constraint ingest_idempotency_hash_ck check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint ingest_idempotency_status_ck check (status in ('in_progress', 'succeeded', 'failed')),
  constraint ingest_idempotency_response_ck check (
    (status = 'succeeded' and response_body is not null and http_status between 200 and 299)
    or status <> 'succeeded'
  )
);

create index if not exists ingest_idempotency_updated_idx
  on batuta.ingest_idempotency (updated_at);

create table if not exists batuta.ingest_rate_windows (
  signer_key_id  text        not null,
  window_started timestamptz not null,
  request_count  integer     not null,
  primary key (signer_key_id, window_started),
  constraint ingest_rate_count_ck check (request_count >= 1)
);

create index if not exists ingest_rate_windows_started_idx
  on batuta.ingest_rate_windows (window_started);

-- Atomically rate-limits and claims one idempotency key. A stale in-progress
-- claim may be reclaimed after five minutes because both downstream writes are
-- themselves idempotent (summary upsert; LAB event UUID/order uniqueness).
create or replace function batuta.claim_ingest_request(
  p_signer_key_id text,
  p_idempotency_key text,
  p_request_kind text,
  p_request_hash text,
  p_limit_per_minute integer default 60
)
returns table (
  claim_status text,
  cached_response jsonb,
  cached_http_status integer
)
language plpgsql
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz := date_trunc('minute', v_now);
  v_count integer;
  v_inserted boolean := false;
  v_existing batuta.ingest_idempotency%rowtype;
begin
  if p_limit_per_minute < 1 or p_limit_per_minute > 10000 then
    raise exception 'invalid ingest rate limit';
  end if;

  delete from batuta.ingest_rate_windows
  where signer_key_id = p_signer_key_id
    and window_started < v_window - interval '10 minutes';

  insert into batuta.ingest_rate_windows (signer_key_id, window_started, request_count)
  values (p_signer_key_id, v_window, 1)
  on conflict (signer_key_id, window_started) do update
    set request_count = batuta.ingest_rate_windows.request_count + 1
  returning request_count into v_count;

  if v_count > p_limit_per_minute then
    return query select 'rate_limited'::text, null::jsonb, 429;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_signer_key_id || ':' || p_idempotency_key, 0)
  );

  insert into batuta.ingest_idempotency (
    signer_key_id, idempotency_key, request_kind, request_hash
  ) values (
    p_signer_key_id, p_idempotency_key, p_request_kind, p_request_hash
  )
  on conflict do nothing
  returning true into v_inserted;

  select * into strict v_existing
  from batuta.ingest_idempotency
  where signer_key_id = p_signer_key_id
    and idempotency_key = p_idempotency_key;

  if v_inserted then
    return query select 'accepted'::text, null::jsonb, 202;
  elsif v_existing.request_kind <> p_request_kind or v_existing.request_hash <> p_request_hash then
    return query select 'conflict'::text, null::jsonb, 409;
  elsif v_existing.status = 'succeeded' then
    return query select 'replay'::text, v_existing.response_body, v_existing.http_status;
  elsif v_existing.status = 'failed'
     or v_existing.updated_at < v_now - interval '5 minutes' then
    update batuta.ingest_idempotency
    set status = 'in_progress', response_body = null, http_status = null, updated_at = v_now
    where signer_key_id = p_signer_key_id and idempotency_key = p_idempotency_key;
    return query select 'accepted'::text, null::jsonb, 202;
  else
    return query select 'in_progress'::text, null::jsonb, 409;
  end if;
end;
$$;

create or replace function batuta.complete_ingest_request(
  p_signer_key_id text,
  p_idempotency_key text,
  p_request_hash text,
  p_response_body jsonb,
  p_http_status integer
)
returns void
language plpgsql
as $$
begin
  update batuta.ingest_idempotency
  set status = 'succeeded',
      response_body = p_response_body,
      http_status = p_http_status,
      updated_at = clock_timestamp()
  where signer_key_id = p_signer_key_id
    and idempotency_key = p_idempotency_key
    and request_hash = p_request_hash
    and status = 'in_progress';
  if not found then
    raise exception 'ingest claim not found or request hash mismatch';
  end if;
end;
$$;

create or replace function batuta.fail_ingest_request(
  p_signer_key_id text,
  p_idempotency_key text,
  p_request_hash text
)
returns void
language sql
as $$
  update batuta.ingest_idempotency
  set status = 'failed', updated_at = clock_timestamp()
  where signer_key_id = p_signer_key_id
    and idempotency_key = p_idempotency_key
    and request_hash = p_request_hash
    and status = 'in_progress'
$$;

create or replace function batuta.jsonb_has_private_key(document jsonb)
returns boolean
language plpgsql
immutable
strict
parallel safe
as $$
declare
  item record;
begin
  if jsonb_typeof(document) = 'object' then
    for item in select key, value from jsonb_each(document)
    loop
      if lower(item.key) = any (array[
        'prompt', 'prompt_hash', 'user_prompt', 'system_prompt', 'messages', 'response',
        'transcript', 'secret', 'secrets', 'password', 'token', 'access_token',
        'api_key', 'private_key', 'authorization', 'cookie', 'environment', 'env',
        'path', 'session_id'
      ]) then
        return true;
      end if;
      if batuta.jsonb_has_private_key(item.value) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(document) = 'array' then
    for item in select value from jsonb_array_elements(document)
    loop
      if batuta.jsonb_has_private_key(item.value) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

create table if not exists batuta.lab_events (
  event_id             uuid        primary key,
  run_id               text        not null,
  project              text        not null,
  event_order          integer     not null,
  tool                 text        not null,
  model                text        not null,
  skill                text,
  cost_usd             numeric(18,8) not null,
  outcome_status       text        not null,
  outcome_authority    text        not null,
  judge_model          text,
  judge_version        text,
  judge_criteria_hash  text,
  runner_receipt       jsonb       not null,
  signer_key_id        text        not null,
  signed_request_at    timestamptz not null,
  request_signature    text        not null,
  request_hash         text        not null,
  payload              jsonb       not null,
  observed_at          timestamptz not null default clock_timestamp(),
  unique (run_id, event_order),
  constraint lab_events_order_ck check (event_order >= 0),
  constraint lab_events_identifier_ck check (
    run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    and project ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    and tool ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    and model ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    and (skill is null or skill ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$')
  ),
  constraint lab_events_cost_ck check (cost_usd >= 0 and cost_usd <= 1000000),
  constraint lab_events_outcome_ck check (
    (outcome_status = 'unknown' and outcome_authority = 'runtime_observation'
      and judge_model is null and judge_version is null and judge_criteria_hash is null)
    or
    (outcome_status in ('passed', 'failed') and outcome_authority = 'independent_judge'
      and judge_model is not null and judge_model <> model
      and judge_version is not null
      and judge_criteria_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint lab_events_receipt_ck check (
    runner_receipt->>'algorithm' = 'ed25519'
    and runner_receipt->>'key_id' = signer_key_id
    and runner_receipt->>'evidence_hash' ~ '^[0-9a-f]{64}$'
    and length(coalesce(runner_receipt->>'signature', '')) between 80 and 128
  ),
  constraint lab_events_request_hash_ck check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint lab_events_private_payload_ck check (not batuta.jsonb_has_private_key(payload))
);

comment on table batuta.lab_events is
  'Privacy-minimized LAB processing events. Batuta observes and aggregates them; a row is not sole proof of delivery. Evidence receipts are signed by the trusted runner, and verdicts come from an independent judge.';
comment on column batuta.lab_events.payload is
  'Allowlisted event metadata only. Database constraint recursively rejects prompts, responses, transcripts, paths, session IDs, credentials, secrets, authorization, cookies, and environment keys.';
comment on column batuta.lab_events.runner_receipt is
  'Detached Ed25519 evidence receipt issued by the trusted runner. Batuta stores and verifies it; Batuta does not issue it.';

create index if not exists lab_events_run_idx
  on batuta.lab_events (run_id, event_order);
create index if not exists lab_events_project_observed_idx
  on batuta.lab_events (project, observed_at desc);
create index if not exists lab_events_tool_model_idx
  on batuta.lab_events (tool, model, observed_at desc);
create index if not exists lab_events_skill_idx
  on batuta.lab_events (skill, observed_at desc) where skill is not null;

create or replace view batuta.lab_event_metrics as
select
  date_trunc('day', observed_at)::date as date,
  project,
  tool,
  model,
  skill,
  count(*)::bigint as events,
  count(*) filter (where outcome_status = 'passed')::bigint as passed,
  count(*) filter (where outcome_status = 'failed')::bigint as failed,
  count(*) filter (where outcome_status = 'unknown')::bigint as unknown,
  sum(cost_usd)::numeric(18,8) as cost_usd
from batuta.lab_events
group by date_trunc('day', observed_at)::date, project, tool, model, skill;

comment on view batuta.lab_event_metrics is
  'Aggregate LAB telemetry without run_id, event_id, order, signatures, or receipt details.';

-- v2 and both v1 wire formats remain readable during the compatibility window.
-- Recalculation is whole-day and idempotent.
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
      summary.installation_id,
      skill->>'skill' as skill,
      coalesce((coalesce(skill->>'routes', skill->>'rotas'))::numeric, 0) as routes,
      coalesce((coalesce(skill->>'activations', skill->>'ativacoes'))::numeric, 0) as activations,
      coalesce((coalesce(skill->>'user_activations', skill->>'ativacoes_usuario'))::numeric, 0) as user_activations,
      coalesce((coalesce(skill->>'judged_turns', skill->>'turns_judged', skill->>'turnos_julgados'))::numeric, 0) as judged_turns,
      coalesce((coalesce(skill->>'successful_turns', skill->>'turns_ok', skill->>'turnos_ok'))::numeric, 0) as successful_turns,
      coalesce((skill->>'reprompts')::numeric, 0) as reprompts,
      coalesce((coalesce(skill->>'errors', skill->>'erros'))::numeric, 0) as errors,
      coalesce((skill->>'retries')::numeric, 0) as retries,
      coalesce((skill->>'tokens_in')::double precision, 0) as tokens_in,
      coalesce((skill->>'tokens_out')::double precision, 0) as tokens_out,
      coalesce((coalesce(skill->>'cost_usd', skill->>'custo_usd'))::numeric, 0) as cost_usd,
      coalesce((coalesce(skill->>'median_turns_to_finish', skill->>'median_turns_to_completion', skill->>'turnos_ate_fim_mediana'))::double precision, 0) as median_turns
    from batuta.daily_summaries summary
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(summary.payload->'skills') = 'array'
           then summary.payload->'skills'
           else '[]'::jsonb end
    ) as skill
    where summary.day = p_day
      and coalesce(skill->>'skill', '') <> ''
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
    sum(judged_turns)::bigint,
    sum(successful_turns)::bigint,
    sum(reprompts)::bigint,
    sum(errors)::bigint,
    sum(retries)::bigint,
    sum(tokens_in),
    sum(tokens_out),
    sum(cost_usd),
    percentile_cont(0.5) within group (order by median_turns) filter (where median_turns > 0),
    count(distinct installation_id)::integer,
    now()
  from rows
  group by skill;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on batuta.ingest_idempotency from public;
revoke all on batuta.ingest_rate_windows from public;
revoke all on batuta.lab_events from public;

commit;

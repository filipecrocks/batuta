#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
container="batuta-sql-test-$$"
image="postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --rm --name "$container" -e POSTGRES_PASSWORD=batuta-test-only -d "$image" >/dev/null
attempt=0
until docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || { printf 'PostgreSQL did not become ready\n' >&2; exit 1; }
  sleep 1
done

# Exercise a full accidental replay as well as the normal ordered application;
# an older baseline must never restore client self-attestation.
for migration in 001_initial.sql 002_chain.sql 003_secure_ingest_lab.sql 001_initial.sql 002_chain.sql 003_secure_ingest_lab.sql; do
  docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    < "$repo_root/sql/$migration"
done

docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
set timezone = 'Pacific/Honolulu';

do $$
declare result record;
begin
  select * into result from batuta.claim_ingest_request(
    'runner-1', 'idem-key-1', 'lab_event', repeat('a', 64), 20
  );
  if result.claim_status <> 'accepted' then raise exception 'first claim: %', row_to_json(result); end if;

  select * into result from batuta.claim_ingest_request(
    'runner-1', 'idem-key-1', 'lab_event', repeat('a', 64), 20
  );
  if result.claim_status <> 'in_progress' then raise exception 'duplicate claim: %', row_to_json(result); end if;

  select * into result from batuta.claim_ingest_request(
    'runner-1', 'idem-key-1', 'lab_event', repeat('b', 64), 20
  );
  if result.claim_status <> 'conflict' then raise exception 'conflicting claim: %', row_to_json(result); end if;

  if not batuta.jsonb_has_private_key('{"nested":{"prompt":"forbidden"}}'::jsonb) then
    raise exception 'recursive privacy guard failed';
  end if;
end $$;

insert into batuta.daily_installation_enrollments (installation_id, signer_key_id)
values ('0123456789abcdef', 'daily-key-1');

insert into batuta.daily_installation_enrollments (installation_id, signer_key_id)
values ('deadbeefdeadbeef', 'revoked-daily-key');
delete from batuta.daily_installation_enrollments
where installation_id = 'deadbeefdeadbeef';

do $$
declare result record;
begin
  select * into strict result from batuta.store_daily_summary(
    'deadbeefdeadbeef', 'revoked-daily-key', '2026-08-24', 'test', 'local',
    '{"schema":"batuta.daily_summary.v2","skills":[]}'::jsonb, repeat('7', 64)
  );
  if result.store_status <> 'not_enrolled' then
    raise exception 'revoked daily enrollment accepted: %', row_to_json(result);
  end if;
  if exists (select 1 from batuta.installations where id = 'deadbeefdeadbeef')
     or exists (select 1 from batuta.daily_summaries where installation_id = 'deadbeefdeadbeef') then
    raise exception 'revoked daily enrollment wrote state';
  end if;
end $$;

do $$
declare result record;
begin
  select * into strict result from batuta.submit_arena_task(
    'arena:test-key-1', repeat('3', 64), 'A sufficiently detailed arena task statement', 'code', 2
  );
  if result.submission_status <> 'accepted' then raise exception 'arena accept: %', row_to_json(result); end if;
  select * into strict result from batuta.submit_arena_task(
    'arena:test-key-1', repeat('3', 64), 'A sufficiently detailed arena task statement', 'code', 2
  );
  if result.submission_status <> 'replay' then raise exception 'arena replay: %', row_to_json(result); end if;
  select * into strict result from batuta.submit_arena_task(
    'arena:test-key-1', repeat('4', 64), 'A different sufficiently detailed arena task', 'code', 2
  );
  if result.submission_status <> 'conflict' then raise exception 'arena conflict: %', row_to_json(result); end if;
  select * into strict result from batuta.submit_arena_task(
    'arena:test-key-2', repeat('5', 64), 'Another sufficiently detailed arena task', 'data', 2
  );
  if result.submission_status <> 'accepted' then raise exception 'arena second accept: %', row_to_json(result); end if;
  select * into strict result from batuta.submit_arena_task(
    'arena:test-key-3', repeat('6', 64), 'Third sufficiently detailed arena task', 'research', 2
  );
  if result.submission_status <> 'rate_limited' then raise exception 'arena rate limit: %', row_to_json(result); end if;
end $$;

select batuta.complete_ingest_request(
  'runner-1', 'idem-key-1', repeat('a', 64), '{"ok":true}'::jsonb, 202
);

do $$
declare result record;
begin
  select * into result from batuta.claim_ingest_request(
    'runner-1', 'idem-key-1', 'lab_event', repeat('a', 64), 20
  );
  if result.claim_status <> 'replay' or (result.cached_response->>'ok')::boolean is distinct from true then
    raise exception 'cached replay: %', row_to_json(result);
  end if;

  select * into result from batuta.claim_ingest_request(
    'runner-1', 'new-key-after-complete', 'lab_event', repeat('9', 64), 2
  );
  if result.claim_status <> 'accepted' then raise exception 'new request before quota: %', row_to_json(result); end if;
  select * into result from batuta.claim_ingest_request(
    'runner-1', 'new-key-over-quota', 'lab_event', repeat('8', 64), 2
  );
  if result.claim_status <> 'rate_limited' then raise exception 'new request rate limit: %', row_to_json(result); end if;
  select * into result from batuta.claim_ingest_request(
    'runner-1', 'idem-key-1', 'lab_event', repeat('a', 64), 2
  );
  if result.claim_status <> 'replay' then raise exception 'completed replay consumed quota: %', row_to_json(result); end if;

  select * into result from batuta.claim_ingest_request(
    'runner-rate', 'rate-key-01', 'lab_event', repeat('c', 64), 2
  );
  if result.claim_status <> 'accepted' then raise exception 'rate claim 1: %', row_to_json(result); end if;
  select * into result from batuta.claim_ingest_request(
    'runner-rate', 'rate-key-02', 'lab_event', repeat('d', 64), 2
  );
  if result.claim_status <> 'accepted' then raise exception 'rate claim 2: %', row_to_json(result); end if;
  select * into result from batuta.claim_ingest_request(
    'runner-rate', 'rate-key-03', 'lab_event', repeat('e', 64), 2
  );
  if result.claim_status <> 'rate_limited' then raise exception 'rate claim 3: %', row_to_json(result); end if;
end $$;

insert into batuta.lab_events (
  event_id, run_id, project, event_order, tool, model, skill, routing_arm,
  holdout_declared, cost_usd,
  outcome_status, outcome_authority, runner_receipt, signer_key_id,
  signed_request_at, request_signature, request_hash, payload, observed_at
) values (
  '01991b40-706d-7ab8-aabb-001122334455', 'run-1', 'lab', 0, 'tool', 'model-a', null,
  'unassigned', false, 0.01,
  'unknown', 'runtime_observation',
  jsonb_build_object('algorithm','ed25519','key_id','runner-1','evidence_hash',repeat('c',64),'signature',repeat('A',86)),
  'runner-1', now(), repeat('B',86), repeat('a',64),
  '{"schema":"batuta.lab_event.v1","cost":{"currency":"USD","amount":0.01}}'::jsonb,
  '2026-08-24 00:30:00+00'
);

insert into batuta.lab_events (
  event_id, run_id, project, event_order, tool, model, skill, routing_arm,
  holdout_declared, cost_usd, outcome_status, outcome_authority, judge_model,
  judge_version, judge_criteria_hash, judge_issuer, judge_key_id,
  judge_signed_at, judge_signature, runner_receipt, signer_key_id,
  signed_request_at, request_signature, request_hash, payload, observed_at
) values (
  '01991b40-706d-7ab8-aabb-001122334457', 'run-judged', 'lab', 0, 'tool',
  'model-a', 'skill-a', 'treatment', true, 0.25, 'passed', 'independent_judge',
  'model-b', 'judge-v1', repeat('d',64), 'judge-service', 'judge-key-1', now(),
  repeat('C',86),
  jsonb_build_object('algorithm','ed25519','key_id','runner-1','evidence_hash',repeat('c',64),'signature',repeat('A',86)),
  'runner-1', now(), repeat('B',86), repeat('e',64),
  '{"schema":"batuta.lab_event.v1","routing":{"arm":"treatment","holdout_declared":true},"cost":{"currency":"USD","amount":0.25}}'::jsonb,
  '2026-08-24 00:30:00+00'
);

-- The same project/run/order is valid for a different trusted runner; a
-- runner-local duplicate remains forbidden.
insert into batuta.lab_events (
  event_id, run_id, project, event_order, tool, model, skill, routing_arm,
  holdout_declared, cost_usd, outcome_status, outcome_authority,
  runner_receipt, signer_key_id, signed_request_at, request_signature,
  request_hash, payload, observed_at
) values (
  '01991b40-706d-7ab8-aabb-001122334459', 'run-judged', 'lab', 0, 'tool',
  'model-a', 'skill-b', 'unassigned', false, 0.10, 'unknown', 'runtime_observation',
  jsonb_build_object('algorithm','ed25519','key_id','runner-2','evidence_hash',repeat('c',64),'signature',repeat('A',86)),
  'runner-2', now(), repeat('B',86), repeat('1',64),
  '{"schema":"batuta.lab_event.v1","routing":{"arm":"unassigned","holdout_declared":false},"cost":{"currency":"USD","amount":0.10}}'::jsonb,
  '2026-08-24 00:30:00+00'
);

do $$
begin
  begin
    insert into batuta.lab_events (
      event_id, run_id, project, event_order, tool, model, routing_arm,
      holdout_declared, cost_usd, outcome_status, outcome_authority,
      runner_receipt, signer_key_id, signed_request_at, request_signature,
      request_hash, payload
    ) values (
      '01991b40-706d-7ab8-aabb-001122334460', 'run-judged', 'lab', 0, 'tool',
      'model-a', 'unassigned', false, 0, 'unknown', 'runtime_observation',
      jsonb_build_object('algorithm','ed25519','key_id','runner-1','evidence_hash',repeat('c',64),'signature',repeat('A',86)),
      'runner-1', now(), repeat('B',86), repeat('2',64), '{}'::jsonb
    );
    raise exception 'runner-local order duplicate unexpectedly accepted';
  exception when unique_violation then null;
  end;
end $$;

do $$
declare metrics record;
begin
  select * into strict metrics from batuta.lab_skill_day_metrics where skill = 'skill-a';
  if metrics.date <> '2026-08-24'::date then
    raise exception 'LAB metric date was not grouped in UTC: %', row_to_json(metrics);
  end if;
  if metrics.turns_judged <> 1 or metrics.turns_ok <> 1 or metrics.cost_usd <> 0.25 then
    raise exception 'receipt-backed skill rollup failed: %', row_to_json(metrics);
  end if;
  select * into strict metrics from batuta.lab_arm_metrics
  where project = 'lab' and model = 'model-a' and routing_arm = 'treatment';
  if metrics.judged <> 1 or metrics.passed <> 1 then
    raise exception 'receipt-backed arm rollup failed: %', row_to_json(metrics);
  end if;
end $$;

insert into batuta.installations (id, batuta_version, mode)
values ('0123456789abcdef', 'test', 'local');
do $$
begin
  begin
    insert into batuta.daily_summaries (installation_id, day, payload, hash)
    values (
      '0123456789abcdef', '2026-08-23',
      '{"skills":[],"nested":{"prompt":"forbidden"}}'::jsonb,
      repeat('0', 64)
    );
    raise exception 'private daily payload unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
do $$
declare result record;
begin
  select * into strict result from batuta.store_daily_summary(
    '0123456789abcdef', 'daily-key-1', '2026-08-24', 'test', 'local',
    '{"skills":[{"skill":"forged","routes":1,"activations":1,"judged_turns":9,"successful_turns":9,"reprompts":0,"errors":0,"retries":0,"tokens_in":0,"tokens_out":0,"cost_usd":0,"median_turns_to_finish":1}]}'::jsonb,
    repeat('f', 64)
  );
  if result.store_status <> 'accepted' or result.rows_recalculated <> 1 then
    raise exception 'enrolled daily summary failed: %', row_to_json(result);
  end if;
end $$;

do $$
declare metrics record;
begin
  select * into strict metrics from batuta.skill_day_metrics
  where skill = 'forged' and day = '2026-08-24';
  if metrics.turns_judged <> 0 or metrics.turns_ok <> 0 then
    raise exception 'client aggregate self-attestation reached rollup: %', row_to_json(metrics);
  end if;
end $$;

do $$
begin
  begin
    insert into batuta.lab_events (
      event_id, run_id, project, event_order, tool, model, cost_usd,
      outcome_status, outcome_authority, runner_receipt, signer_key_id,
      signed_request_at, request_signature, request_hash, payload
    ) values (
      '01991b40-706d-7ab8-aabb-001122334456', 'run-2', 'lab', 0, 'tool', 'model-a', 0,
      'unknown', 'runtime_observation',
      jsonb_build_object('algorithm','ed25519','key_id','runner-1','evidence_hash',repeat('c',64),'signature',repeat('A',86)),
      'runner-1', now(), repeat('B',86), repeat('a',64), '{"nested":{"session_id":"forbidden"}}'::jsonb
    );
    raise exception 'privacy constraint unexpectedly accepted a session ID';
  exception when check_violation then null;
  end;
end $$;

do $$
begin
  begin
    insert into batuta.lab_events (
      event_id, run_id, project, event_order, tool, model, cost_usd,
      outcome_status, outcome_authority, judge_model, judge_version,
      judge_criteria_hash, runner_receipt, signer_key_id, signed_request_at,
      request_signature, request_hash, payload
    ) values (
      '01991b40-706d-7ab8-aabb-001122334458', 'run-unsigned-judge', 'lab', 0,
      'tool', 'model-a', 0, 'passed', 'independent_judge', 'model-b', 'judge-v1',
      repeat('d',64),
      jsonb_build_object('algorithm','ed25519','key_id','runner-1','evidence_hash',repeat('c',64),'signature',repeat('A',86)),
      'runner-1', now(), repeat('B',86), repeat('a',64), '{}'::jsonb
    );
    raise exception 'unsigned judge verdict unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
SQL

printf 'SQL migrations and ingest invariants passed\n'

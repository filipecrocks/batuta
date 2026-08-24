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

for migration in 001_initial.sql 002_chain.sql 003_secure_ingest_lab.sql 003_secure_ingest_lab.sql; do
  docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    < "$repo_root/sql/$migration"
done

docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
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
  event_id, run_id, project, event_order, tool, model, skill, cost_usd,
  outcome_status, outcome_authority, runner_receipt, signer_key_id,
  signed_request_at, request_signature, request_hash, payload
) values (
  '01991b40-706d-7ab8-aabb-001122334455', 'run-1', 'lab', 0, 'tool', 'model-a', null, 0.01,
  'unknown', 'runtime_observation',
  jsonb_build_object('algorithm','ed25519','key_id','runner-1','evidence_hash',repeat('c',64),'signature',repeat('A',86)),
  'runner-1', now(), repeat('B',86), repeat('a',64),
  '{"schema":"batuta.lab_event.v1","cost":{"currency":"USD","amount":0.01}}'::jsonb
);

insert into batuta.installations (id, batuta_version, mode)
values ('0123456789abcdef', 'test', 'local');
insert into batuta.daily_summaries (installation_id, day, payload, hash)
values (
  '0123456789abcdef', '2026-08-24',
  '{"skills":[{"skill":"forged","routes":1,"activations":1,"judged_turns":9,"successful_turns":9,"reprompts":0,"errors":0,"retries":0,"tokens_in":0,"tokens_out":0,"cost_usd":0,"median_turns_to_finish":1}]}'::jsonb,
  repeat('f', 64)
);
select batuta.recalculate_day_metrics('2026-08-24');

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
SQL

printf 'SQL migrations and ingest invariants passed\n'

-- BATUTA — the hash chain doesn't get patched (§8)
--
-- Read this before touching anything: THIS DATABASE IS NOT THE SOURCE OF TRUTH.
-- The source is the records/ folder in the public git repository — a signed
-- history, distributed in every clone — and the OpenTimestamps stamp over
-- records/TOP.txt, which anchors the top of the chain in the Bitcoin network,
-- out of reach of anyone here. Whoever holds the role of this database's owner
-- can, with deliberate effort, drop the triggers below and rewrite whatever they
-- want; what they can't do is rewrite other people's clones or the stamp already
-- issued.
--
-- So why lock it down? Because the chain can't break BY ACCIDENT. A poorly
-- written migration UPDATE, an end-of-semester cleanup DELETE, an overeager
-- ORM — any of these would silently render the historical series useless, and
-- nobody would notice until an outsider checks and the project loses the one
-- thing it has (§14.1). Breaking the chain HAS TO HURT, and it has to hurt
-- immediately, with the exception thrown right in the face of whoever tried.
--
-- Apply after sql/001_initial.sql.

begin;

-- ---------------------------------------------------------------- immutability

create or replace function batuta.records_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'batuta.records is append-only: % refused. The hash chain only moves forward — to fix a record, APPEND a new record of type "correction" pointing at the hash of the wrong one. The mistake stays visible; that was the deal.',
    tg_op
    using errcode = 'raise_exception',
          hint = 'If you are the database owner and genuinely need this, the path is explicit: ALTER TABLE batuta.records DISABLE TRIGGER ... — and then it is recorded in the history of who did it.';
  return null;
end;
$$;

drop trigger if exists records_no_update on batuta.records;
create trigger records_no_update
  before update on batuta.records
  for each row execute function batuta.records_immutable();

drop trigger if exists records_no_delete on batuta.records;
create trigger records_no_delete
  before delete on batuta.records
  for each row execute function batuta.records_immutable();

-- TRUNCATE doesn't go through a row-level trigger: without this, `truncate` would
-- take out the whole table without firing anything.
drop trigger if exists records_no_truncate on batuta.records;
create trigger records_no_truncate
  before truncate on batuta.records
  for each statement execute function batuta.records_immutable();

-- ------------------------------------------------------------------- verification

-- Returns the id of the FIRST record where the chain breaks, or NULL if the
-- chain is intact. The reason comes out as a NOTICE.
--
-- PAY ATTENTION TO WHAT THIS FUNCTION **DOES NOT** DO: it does not recompute the
-- sha256 of the body. It's not laziness — it's impossible to get right here.
-- Batuta's canonical hash is the sha256 of the JSON with keys in alphabetical
-- order and no spaces (Rust's json::write, portal/lib/chain.ts,
-- script/chain.mjs); Postgres's `jsonb::text` orders keys by length and then by
-- byte, which is a different string, with a different hash. Pretending to
-- verify it would be worse than not verifying at all. Content verification is
-- `node script/chain.mjs verify`, run over the repository's files — which is
-- where the truth lives anyway.
--
-- What this function DOES catch: a link pointing to the wrong record, a hole in
-- the middle, a duplicated genesis, a malformed hash. In other words: tampering
-- that got past the triggers above.
create or replace function batuta.verify_chain()
returns bigint
language plpgsql
stable
as $$
declare
  r        record;
  expected text := null;
  first    boolean := true;
  genesis  constant text := repeat('0', 64);
begin
  for r in
    select id, hash, previous_hash from batuta.records order by id asc
  loop
    if first then
      -- genesis points to nothing: NULL or 64 zeros, nothing else
      if r.previous_hash is not null and r.previous_hash <> genesis then
        raise notice 'record % is the first in the table but points at %, which is not here: either the start of the chain is missing, or it was deleted', r.id, r.previous_hash;
        return r.id;
      end if;
    else
      if r.previous_hash is null or r.previous_hash <> expected then
        raise notice 'record % breaks the chain: previous_hash=% but the previous record has hash=%', r.id, coalesce(r.previous_hash, '(null)'), expected;
        return r.id;
      end if;
    end if;

    if r.hash !~ '^[0-9a-f]{64}$' then
      raise notice 'record % has a malformed hash: %', r.id, r.hash;
      return r.id;
    end if;

    expected := r.hash;
    first := false;
  end loop;

  if first then
    raise notice 'empty chain — nothing to verify';
  else
    raise notice 'chain intact up to top %', expected;
  end if;
  return null;
end;
$$;

comment on function batuta.verify_chain() is
  'First broken link, or NULL. Only verifies the chaining; the content hash is verified with `node script/chain.mjs verify`, because Postgres''s jsonb does not reproduce the canonical key order.';

-- Top of the chain, for the portal and for the OpenTimestamps stamp.
create or replace view batuta.chain_top as
  select id, type, hash, previous_hash, created_at
  from batuta.records
  order by id desc
  limit 1;

commit;

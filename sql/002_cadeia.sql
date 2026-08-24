-- BATUTA — the hash chain doesn't get patched (§8)
--
-- Read this before touching anything: THIS DATABASE IS NOT THE SOURCE OF TRUTH.
-- The source is the registros/ folder in the public git repository — a signed
-- history, distributed in every clone — and the OpenTimestamps stamp over
-- registros/TOPO.txt, which anchors the top of the chain in the Bitcoin network,
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
-- Apply after sql/001_inicial.sql.

begin;

-- ---------------------------------------------------------------- immutability

create or replace function batuta.registros_imutaveis()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'batuta.registros e append-only: % recusado. A corrente de hash so anda para frente — para corrigir um registro, ANEXE um registro novo do tipo "correcao" apontando para o hash do errado. O erro fica visivel; era esse o combinado.',
    tg_op
    using errcode = 'raise_exception',
          hint = 'Se voce e o dono do banco e realmente precisa disso, o caminho e explicito: ALTER TABLE batuta.registros DISABLE TRIGGER ... — e ai fica registrado no historico de quem fez.';
  return null;
end;
$$;

drop trigger if exists registros_sem_update on batuta.registros;
create trigger registros_sem_update
  before update on batuta.registros
  for each row execute function batuta.registros_imutaveis();

drop trigger if exists registros_sem_delete on batuta.registros;
create trigger registros_sem_delete
  before delete on batuta.registros
  for each row execute function batuta.registros_imutaveis();

-- TRUNCATE doesn't go through a row-level trigger: without this, `truncate` would
-- take out the whole table without firing anything.
drop trigger if exists registros_sem_truncate on batuta.registros;
create trigger registros_sem_truncate
  before truncate on batuta.registros
  for each statement execute function batuta.registros_imutaveis();

-- ------------------------------------------------------------------- verification

-- Returns the id of the FIRST record where the chain breaks, or NULL if the
-- chain is intact. The reason comes out as a NOTICE.
--
-- PAY ATTENTION TO WHAT THIS FUNCTION **DOES NOT** DO: it does not recompute the
-- sha256 of the body. It's not laziness — it's impossible to get right here. Batuta's
-- canonical hash is the sha256 of the JSON with keys in alphabetical order and no
-- spaces (Rust's json::escrever, portal/lib/cadeia.ts, script/cadeia.mjs); Postgres's
-- `jsonb::text` orders keys by length and then by byte, which is a different
-- string, with a different hash. Pretending to verify it would be worse than not
-- verifying at all. Content verification is `node script/cadeia.mjs verificar`,
-- run over the repository's files — which is where the truth lives anyway.
--
-- What this function DOES catch: a link pointing to the wrong record, a hole in
-- the middle, a duplicated genesis, a malformed hash. In other words: tampering
-- that got past the triggers above.
create or replace function batuta.verificar_cadeia()
returns bigint
language plpgsql
stable
as $$
declare
  r          record;
  esperado   text := null;
  primeiro   boolean := true;
  genesis    constant text := repeat('0', 64);
begin
  for r in
    select id, hash, hash_anterior from batuta.registros order by id asc
  loop
    if primeiro then
      -- genesis points to nothing: NULL or 64 zeros, nothing else
      if r.hash_anterior is not null and r.hash_anterior <> genesis then
        raise notice 'registro % e o primeiro da tabela mas aponta para %, que nao esta aqui: ou falta o comeco da corrente, ou ele foi apagado', r.id, r.hash_anterior;
        return r.id;
      end if;
    else
      if r.hash_anterior is null or r.hash_anterior <> esperado then
        raise notice 'registro % quebra a corrente: hash_anterior=% mas o registro anterior tem hash=%', r.id, coalesce(r.hash_anterior, '(nulo)'), esperado;
        return r.id;
      end if;
    end if;

    if r.hash !~ '^[0-9a-f]{64}$' then
      raise notice 'registro % tem hash fora de forma: %', r.id, r.hash;
      return r.id;
    end if;

    esperado := r.hash;
    primeiro := false;
  end loop;

  if primeiro then
    raise notice 'corrente vazia — nada para verificar';
  else
    raise notice 'corrente inteira ate o topo %', esperado;
  end if;
  return null;
end;
$$;

comment on function batuta.verificar_cadeia() is
  'First broken link, or NULL. Only verifies the chaining; the content hash is verified with `node script/cadeia.mjs verificar`, because Postgres''s jsonb does not reproduce the canonical key order.';

-- Top of the chain, for the portal and for the OpenTimestamps stamp.
create or replace view batuta.topo_cadeia as
  select id, tipo, hash, hash_anterior, criado_em
  from batuta.registros
  order by id desc
  limit 1;

commit;

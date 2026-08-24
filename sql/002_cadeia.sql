-- BATUTA — a corrente de hash não se remenda (§8)
--
-- Leia isto antes de mexer: ESTE BANCO NÃO É A FONTE DE VERDADE. A fonte é a pasta
-- registros/ no repositório git público — histórico assinado, distribuído em cada
-- clone — e o carimbo do OpenTimestamps sobre registros/TOPO.txt, que ancora o topo
-- da corrente na rede Bitcoin, fora do alcance de qualquer um daqui. Quem tem o
-- papel de dono deste banco consegue, com esforço deliberado, dropar os gatilhos
-- abaixo e reescrever o que quiser; o que ele não consegue é reescrever os clones
-- alheios nem o carimbo já emitido.
--
-- Então por que travar? Porque a corrente não pode quebrar POR ACIDENTE. Um UPDATE
-- de migração mal escrita, um DELETE de limpeza de fim de semestre, um ORM
-- entusiasmado — qualquer um desses inutilizaria a série histórica em silêncio, e
-- ninguém perceberia até alguém de fora conferir e o projeto perder a única coisa
-- que ele tem (§14.1). Quebrar a corrente TEM QUE DOER, e tem que doer na hora, com
-- exceção na cara de quem tentou.
--
-- Aplicar depois de sql/001_inicial.sql.

begin;

-- ---------------------------------------------------------------- imutabilidade

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

-- TRUNCATE não passa por gatilho de linha: sem este, `truncate` levaria a tabela
-- inteira sem disparar nada.
drop trigger if exists registros_sem_truncate on batuta.registros;
create trigger registros_sem_truncate
  before truncate on batuta.registros
  for each statement execute function batuta.registros_imutaveis();

-- ------------------------------------------------------------------- verificação

-- Devolve o id do PRIMEIRO registro em que o encadeamento quebra, ou NULL se a
-- corrente está inteira. O motivo sai como NOTICE.
--
-- ATENÇÃO AO QUE ESTA FUNÇÃO **NÃO** FAZ: ela não recalcula o sha256 do corpo. Não
-- é preguiça — é impossível fazer certo aqui. O hash canônico do Batuta é o sha256
-- do JSON com as chaves em ordem alfabética e sem espaço (json::escrever do Rust,
-- portal/lib/cadeia.ts, script/cadeia.mjs); o `jsonb::text` do Postgres ordena as
-- chaves por tamanho e depois por byte, que é outra string, com outro hash. Fingir
-- que confere seria pior que não conferir. A conferência do conteúdo é
-- `node script/cadeia.mjs verificar`, sobre os arquivos do repositório — que é onde
-- a verdade mora de qualquer jeito.
--
-- O que ESTA função pega: elo apontando para o registro errado, buraco no meio,
-- gênesis duplicado, hash fora de forma. Ou seja: adulteração que passou por cima
-- dos gatilhos acima.
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
      -- o gênesis aponta para o nada: NULL ou 64 zeros, nada além disso
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
  'Primeiro elo quebrado, ou NULL. Confere SO o encadeamento; o hash do conteudo se confere com `node script/cadeia.mjs verificar`, porque o jsonb do Postgres nao reproduz a ordem canonica das chaves.';

-- Topo da corrente, para o portal e para o carimbo do OpenTimestamps.
create or replace view batuta.topo_cadeia as
  select id, tipo, hash, hash_anterior, criado_em
  from batuta.registros
  order by id desc
  limit 1;

commit;

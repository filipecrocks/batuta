-- BATUTA — esquema inicial (Postgres 16 / Neon)
--
-- Este banco é CACHE DE LEITURA, não fonte de verdade. A verdade é o repositório
-- git público (protocolo, bateria, resultados crus) mais a cadeia de hash de
-- registros/, carimbada fora do nosso controle por OpenTimestamps (§8). Se este
-- banco for perdido inteiro, ele se reconstrói dos arquivos; se ele for adulterado,
-- a corrente de hash denuncia. Por isso ninguém aqui guarda nada que não possa ser
-- republicado em público amanhã de manhã.
--
-- Aplicar com:  psql "$DATABASE_URL" -f sql/001_inicial.sql

begin;

create schema if not exists batuta;

-- =========================================================================
-- FROTA
-- =========================================================================

-- Uma linha por instalação do binário. O id chega PRONTO do cliente: é
-- sha256('instalacao|' || sal_local)[..16], derivado de um sal que nunca sai da
-- máquina (casa::id_instalacao). O servidor não gera, não confere e não consegue
-- reverter esse id — ele só serve para dizer "estas linhas vieram da mesma máquina".
--
-- NÃO EXISTE, DE PROPÓSITO: coluna de IP, de user agent, de país, de fuso, de
-- hostname, de e-mail. Não é esquecimento nem "fica para depois". Dado que não se
-- coleta não vaza, não é intimado, não é vendido junto numa aquisição e não muda de
-- ideia quando muda a diretoria. O único produto do Batuta é credibilidade (§14.1);
-- guardar IP para "entender melhor a distribuição geográfica" custaria mais do que
-- qualquer gráfico que ele produzisse. Quem operar o ingest tem que garantir também
-- que o log de acesso do provedor não guarde IP com o corpo — o schema aqui só
-- resolve a metade que é nossa.
create table if not exists batuta.instalacoes (
  id             text        primary key,
  primeiro_visto timestamptz not null default now(),
  ultimo_visto   timestamptz not null default now(),
  versao_batuta  text,
  modo           text,
  constraint instalacoes_id_formato check (id ~ '^[0-9a-f]{16}$')
);

comment on table  batuta.instalacoes is 'Frota. Sem IP, sem user agent, sem geolocalização — ver comentário no DDL.';
comment on column batuta.instalacoes.modo is 'local (hook, funil completo) ou degradado (MCP/skill, funil incompleto). Anda junto do número porque muda o que o número significa.';

-- O corpo cru que a instalação enviou, guardado como chegou. Guardar o payload
-- inteiro em jsonb é o que permite recalcular o rollup depois de um bug de
-- agregação sem pedir nada de volta para a frota.
--
-- REENVIO DO MESMO DIA SUBSTITUI, NÃO DUPLICA: a chave primária é (instalacao_id,
-- dia). O cliente pode mandar o resumo do dia às 14h e de novo às 23h com o dia
-- fechado; a segunda versão é a boa. Sem isso, cada retentativa de rede viraria
-- usuário novo no ranking.
create table if not exists batuta.resumos_diarios (
  instalacao_id text        not null references batuta.instalacoes(id) on delete cascade,
  dia           date        not null,
  payload       jsonb       not null,
  recebido_em   timestamptz not null default now(),
  hash          text        not null,
  -- a PK composta É o UNIQUE(instalacao_id, dia) exigido pelo protocolo de ingestão
  primary key (instalacao_id, dia)
);

comment on column batuta.resumos_diarios.hash is 'sha256 do payload em JSON canônico (chaves alfabéticas, sem espaço — igual a json::escrever do Rust). Serve para o remetente conferir que o que chegou é byte a byte o que ele mandou.';

create index if not exists resumos_diarios_dia_idx        on batuta.resumos_diarios (dia desc);
create index if not exists resumos_diarios_recebido_idx   on batuta.resumos_diarios (recebido_em desc);

-- =========================================================================
-- ROLLUP — a única tabela que as páginas estáticas leem
-- =========================================================================

-- O lote noturno (e o próprio ingest, para o dia recebido) reescreve isto a partir
-- de resumos_diarios. É derivada: pode ser apagada inteira e reconstruída. Fica
-- desnormalizada de propósito, porque a página é estática e a consulta tem que ser
-- um SELECT burro sem join.
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
  -- quantas instalações distintas entraram nesta linha. É o n da amostra: taxa sem
  -- n não se publica, e linha com instalacoes=1 é anedota, não medição.
  instalacoes            integer     not null default 0,
  atualizado_em          timestamptz not null default now(),
  primary key (skill, dia)
);

comment on column batuta.metricas_skill_dia.custo_usd is 'numeric e não float: dinheiro somado em float acumula erro e a manchete do projeto é justamente custo por tarefa concluída.';
comment on column batuta.metricas_skill_dia.turnos_ate_fim_mediana is 'Mediana das medianas por instalação — aproximação assumida. A mediana exata exigiria subir a distribuição, e distribuição por turno é evento cru disfarçado (§4.5).';

create index if not exists metricas_skill_dia_dia_idx   on batuta.metricas_skill_dia (dia desc);
create index if not exists metricas_skill_dia_skill_idx on batuta.metricas_skill_dia (skill, dia desc);

-- =========================================================================
-- CATÁLOGO DE SKILLS
-- =========================================================================

-- Registro de skill vista, não redistribuição. Skill sem licença clara não entra no
-- kit: vira instalador que aponta para a fonte (§4.6). licenca_verificada é
-- afirmação de gente que abriu o arquivo LICENSE, não de scraper que leu badge.
create table if not exists batuta.skills (
  slug               text        primary key,
  nome               text        not null,
  fonte_url          text,
  licenca            text,
  licenca_verificada boolean     not null default false,
  primeira_vista     timestamptz not null default now()
);

-- lista curta e muito consultada: "o que ainda está sem licença conferida?"
create index if not exists skills_licenca_pendente_idx
  on batuta.skills (slug) where licenca_verificada = false;

-- =========================================================================
-- ARENA
-- =========================================================================

-- CREATE TYPE não aceita IF NOT EXISTS; o DO deixa o arquivo reaplicável.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'status_tarefa' and n.nspname = 'batuta'
  ) then
    create type batuta.status_tarefa as enum (
      'triagem',     -- chegou, ninguém olhou
      'recusada',    -- executável escondido, fora de escopo, spam
      'duplicada',   -- já existe tarefa equivalente
      'canonizada',  -- reescrita em enunciado + critério de aceite
      'fila',        -- canonizada e votada, esperando rodada
      'rodando',
      'publicada'
    );
  end if;
end
$$;

-- TAREFA ENVIADA NUNCA RODA COMO CHEGOU (§10). enunciado_original é o que a pessoa
-- escreveu e fica intocado para auditoria; enunciado_canonico é o que a bateria
-- executa, e nasce NULL — ninguém pula a canonização por pressa. Quem envia sugere o
-- problema; a régua é do Batuta. Sem essa porta, autor de skill manda exatamente a
-- tarefa que a skill dele vence e o ranking vira vitrine.
create table if not exists batuta.tarefas (
  id                 bigint generated always as identity primary key,
  enunciado_original text        not null,
  enunciado_canonico text,
  criterio_aceite    jsonb,
  categoria          text,
  complexidade       text,
  status             batuta.status_tarefa not null default 'triagem',
  origem             text        not null default 'publico',
  -- contato é opcional e serve para uma coisa só: avisar quem enviou quando a
  -- tarefa rodar. Não vira lista, não vira newsletter, não vira login.
  contato            text,
  criado_em          timestamptz not null default now(),
  constraint tarefas_categoria_ck check (
    categoria is null or categoria in ('codigo','escrita','dados','documentos','pesquisa','automacao')
  ),
  constraint tarefas_complexidade_ck check (
    complexidade is null or complexidade in ('simples','media','complexa')
  ),
  -- estado só avança para depois da canonização se existir enunciado canônico e
  -- critério de aceite. O banco segura a regra que a pressa quebraria.
  constraint tarefas_canonizada_ck check (
    status in ('triagem','recusada','duplicada')
    or (enunciado_canonico is not null and criterio_aceite is not null)
  )
);

create index if not exists tarefas_status_idx on batuta.tarefas (status, criado_em desc);

-- VOTO DECIDE A FILA, NUNCA O RESULTADO (§1.6). Esta tabela não tem coluna de nota,
-- de estrela, de "gostei" — de propósito: se um dia alguém quiser somar voto no
-- ranking, vai ter que alterar o schema em público. impressao_digital é um
-- identificador fraco de navegador (o suficiente para atrapalhar voto repetido, longe
-- do suficiente para identificar alguém) e por isso o UNIQUE é anti-ruído, não
-- antifraude. Popularidade é marketing; a régua é desfecho medido (§14.4).
create table if not exists batuta.votos (
  tarefa_id        bigint      not null references batuta.tarefas(id) on delete cascade,
  impressao_digital text       not null,
  criado_em        timestamptz not null default now(),
  primary key (tarefa_id, impressao_digital)
);

-- =========================================================================
-- RODADAS (matriz de testes, §7)
-- =========================================================================

create table if not exists batuta.rodadas (
  id              bigint generated always as identity primary key,
  tarefa_id       bigint references batuta.tarefas(id) on delete set null,
  modelo          text        not null,
  -- canal não multiplica a matriz principal (§7.2): a matriz roda num canal só e a
  -- comparação entre canais é experimento separado. A coluna existe para que a
  -- comparação seja possível, não para virar eixo por descuido.
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
  -- URL do cru publicado: prompt, saídas dos dois braços, veredito. Publicar o cru é
  -- o que separa o Batuta de README autoproclamado (§9.5).
  bruto_url       text,
  criado_em       timestamptz not null default now(),
  constraint rodadas_braco_ck check (braco in ('sem','skill','receita')),
  constraint rodadas_receita_ck check (braco <> 'receita' or receita_slug is not null),
  constraint rodadas_veredito_ck check (veredito is null or veredito in ('ok','falhou','inconclusivo')),
  -- O JUIZ NÃO É O RÉU (§6.2): modelo nunca julga a própria saída. Julgamento cruzado
  -- é lei do protocolo, então é constraint e não convenção.
  constraint rodadas_juiz_cruzado_ck check (juiz_modelo is null or juiz_modelo <> modelo),
  -- juiz sem versão e sem hash do prompt invalida a série histórica (§6.3)
  constraint rodadas_juiz_versionado_ck check (
    juiz_modelo is null or (juiz_versao is not null and juiz_prompt_hash is not null)
  )
);

create index if not exists rodadas_tarefa_idx  on batuta.rodadas (tarefa_id, criado_em desc);
create index if not exists rodadas_modelo_idx  on batuta.rodadas (modelo, criado_em desc);
create index if not exists rodadas_receita_idx on batuta.rodadas (receita_slug) where receita_slug is not null;

-- =========================================================================
-- RECEITAS (§5)
-- =========================================================================

-- Receita é citável e comparável, então versão é parte da identidade: 'iniciante v3'
-- não sobrescreve 'iniciante v2', convive com ela. Quem citou v2 num relatório
-- continua podendo abrir exatamente o que citou.
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
  -- só entra na receita o que o teste aprovou: publicar sem bloco de evidência colado
  -- é exatamente o que o projeto existe para não fazer
  constraint receitas_evidencia_ck check (publicada_em is null or evidencia <> '{}'::jsonb)
);

comment on column batuta.receitas.skills is 'Lista de {slug, versao} — skills FIXADAS em versão. Receita que aponta para "a última" não é reprodutível.';

create index if not exists receitas_publicadas_idx on batuta.receitas (publicada_em desc) where publicada_em is not null;

-- =========================================================================
-- CADEIA DE HASH (§8)
-- =========================================================================

-- Espelho no banco da pasta registros/ do repositório. bigserial e não identity
-- porque a ordem de id É a ordem da corrente e precisa ser trivial de ler.
-- As proteções (imutabilidade e verificação) estão em sql/002_cadeia.sql.
create table if not exists batuta.registros (
  id             bigserial   primary key,
  tipo           text        not null,
  corpo          jsonb       not null,
  hash           text        not null unique,
  -- NULL só no gênesis; daí em diante é o hash do registro anterior
  hash_anterior  text,
  criado_em      timestamptz not null default now(),
  constraint registros_hash_ck          check (hash ~ '^[0-9a-f]{64}$'),
  constraint registros_hash_anterior_ck check (hash_anterior is null or hash_anterior ~ '^[0-9a-f]{64}$')
);

create index if not exists registros_criado_idx on batuta.registros (criado_em desc);
create index if not exists registros_tipo_idx   on batuta.registros (tipo, id desc);
-- a RAG só responde com o que está publicado, e cada resposta sai com link + hash
-- (§11): a busca dentro do corpo é caminho quente do portal, então tem índice
create index if not exists registros_corpo_gin  on batuta.registros using gin (corpo jsonb_path_ops);

-- =========================================================================
-- COLABORADORES — crédito é o salário (§1.1)
-- =========================================================================

-- Zero lucro, sempre. Ninguém recebe dinheiro; o nome no portal e no dataset é o
-- pagamento, e é por isso que esta tabela é infraestrutura e não enfeite: é a única
-- forma de retenção que o projeto pode oferecer (§14.2).
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

-- Recalcula o dia inteiro do zero em vez de somar incrementalmente. É mais caro e é
-- o certo: reenvio substitui (a PK garante), então somar incremento duplicaria o dia
-- de quem mandou duas vezes. Idempotente por construção — pode rodar quantas vezes
-- quiser, o resultado é o mesmo.
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
    -- mediana só entre quem mediu: instalação sem turno concluído entraria como 0 e
    -- puxaria o número para baixo sem ter medido nada
    percentile_cont(0.5) within group (order by mediana) filter (where mediana > 0),
    count(distinct instalacao_id)::integer,
    now()
  from linhas
  group by skill;

  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function batuta.recalcular_metricas_dia(date) is 'Idempotente: apaga o dia e reescreve. Chamada pelo ingest para o dia recebido e pelo lote noturno para a janela inteira.';

commit;

# PROTOCOLO — Batuta Zero

Procedimento executável do primeiro experimento do Batuta. Escrito para o Filipe
rodar sozinho, do começo ao fim, sem precisar decidir nada no meio do caminho.

**Tamanho da primeira leva:** 5 tarefas × 4 modelos × 2 braços = **40 rodadas**
(≈ 1 semana).

O dado zero não vale pelo resultado. Vale por ser o primeiro número do mundo sobre
skills produzido com ordem sorteada, sessão limpa, julgamento cego e cru publicado.
Se o protocolo escorregar, o dado vira lixo — e lixo publicado com carimbo de
medição é pior que nenhum dado.

---

## 0. Antes de começar

### 0.1 As cinco tarefas

Não se escreve tarefa nova para o Zero. Usa-se a bateria congelada, para que o
primeiro dado já seja comparável com tudo que vem depois.

| código do Zero | tarefa da bateria v1 | categoria | verificação |
|---|---|---|---|
| `z-01` | `cod-01` | codigo | automática |
| `z-02` | `cod-02` | codigo | automática |
| `z-03` | `cod-03` | codigo | automática |
| `z-04` | `cod-04` | codigo | automática |
| `z-05` | `esc-01` | escrita | mista |

Quatro automáticas dão o número quase de graça. A quinta existe para o
procedimento de julgamento cego rodar de verdade nesta leva, e não estrear em
produção.

### 0.2 Os quatro modelos

Um por faixa. O nome exato entra em `manifesto.json` (passo 1.3), não neste
documento — modelo troca, faixa não.

| id | faixa |
|---|---|
| `m1` | topo pago |
| `m2` | faixa média |
| `m3` | pequeno |
| `m4` | grátis / local |

Canal único para todas as 40 rodadas: **OpenRouter**. Ver "canal não multiplica"
em `bateria/v1/README.md`.

### 0.3 Os dois braços

| id | o que está ligado |
|---|---|
| `A` | `sem-nada` — nenhuma skill instalada, roteador desligado |
| `B` | `com-skill` — apenas as `skills_candidatas` da tarefa, roteador ligado |

O enunciado é **idêntico, palavra por palavra**, nos dois. A diferença mora no
ambiente e em nenhum outro lugar.

---

## 1. Passos

### Passo 1 — Fixar o terreno (uma vez, antes de qualquer rodada)

**1.1 Criar a estrutura.**

```bash
mkdir -p ~/batuta-zero/{tarefas,rodadas,cego,vereditos,publicacao}
cd ~/batuta-zero
```

**1.2 Publicar a semente, antes de tudo.**

A semente é o que torna o sorteio auditável: qualquer pessoa refaz o sorteio e tem
que chegar na mesma ordem.

```bash
SEED="batuta-zero-v1-$(date +%Y-%m-%d)-$(head -c 8 /dev/urandom | xxd -p)"
printf 'SEED=%s\n' "$SEED" > SEED.txt
cat SEED.txt
git add SEED.txt && git commit -m "batuta zero: semente publicada antes da primeira rodada"
git push
```

O commit da semente **vem antes** da primeira rodada. Semente publicada depois não
vale nada: quem publica depois escolhe a semente que dá a ordem que quer.

**1.3 Congelar o manifesto da leva.**

```bash
cat > manifesto.json <<'JSON'
{
  "leva": "batuta-zero-1",
  "bateria": "batuta.bateria.v1@1.0.0",
  "canal": "openrouter",
  "tarefas": ["cod-01", "cod-02", "cod-03", "cod-04", "esc-01"],
  "modelos": {
    "m1": {"faixa": "topo-pago",    "id_canal": "PREENCHER", "versao": "PREENCHER"},
    "m2": {"faixa": "media",        "id_canal": "PREENCHER", "versao": "PREENCHER"},
    "m3": {"faixa": "pequeno",      "id_canal": "PREENCHER", "versao": "PREENCHER"},
    "m4": {"faixa": "gratis-local", "id_canal": "PREENCHER", "versao": "PREENCHER"}
  },
  "bracos": {"A": "sem-nada", "B": "com-skill"},
  "temperatura": 0,
  "teto_turnos": "o teto_turnos de cada tarefa em tarefas.json",
  "holdout_causal": "desligado nesta leva (ver secao 5)"
}
JSON
```

Preencher os `PREENCHER` com o identificador e a versão servida de cada modelo,
copiados do canal. Commit antes da primeira rodada.

**1.4 Extrair os cinco enunciados, palavra por palavra.**

```bash
python3 - <<'PY'
import json, pathlib
b = json.load(open('/caminho/para/batuta/bateria/v1/tarefas.json', encoding='utf-8'))
alvo = {'cod-01': 'z-01', 'cod-02': 'z-02', 'cod-03': 'z-03',
        'cod-04': 'z-04', 'esc-01': 'z-05'}
for t in b['tarefas']:
    if t['id'] in alvo:
        p = pathlib.Path('tarefas') / (alvo[t['id']] + '.md')
        p.write_text(t['enunciado'] + '\n', encoding='utf-8')
        print(p, len(t['enunciado']), 'caracteres')
PY
sha256sum tarefas/*.md > tarefas/CHECKSUMS.txt
git add tarefas && git commit -m "batuta zero: enunciados congelados" && git push
```

A partir daqui, `tarefas/*.md` é lei. Conferir os checksums antes de cada dia de
rodada:

```bash
sha256sum -c tarefas/CHECKSUMS.txt
```

Se falhar, a série está contaminada: para tudo e recomeça (seção 4).

---

### Passo 2 — Sortear a ordem dos braços, de forma determinística

Rodar o braço B sempre primeiro mede aquecimento, não skill. A ordem de cada par
(tarefa × modelo) é sorteada — e o sorteio sai da semente, não do dedo.

**2.1 A função de sorteio.**

```bash
. ./SEED.txt

braco_primeiro () {   # $1 = tarefa, $2 = modelo
  h=$(printf '%s|%s|%s' "$SEED" "$1" "$2" | sha256sum | cut -c1-8)
  if [ $(( 0x$h % 2 )) -eq 0 ]; then echo "A B"; else echo "B A"; fi
}
```

**2.2 Gerar o plano das 20 duplas (40 rodadas).**

```bash
: > plano.tsv
for t in z-01 z-02 z-03 z-04 z-05; do
  for m in m1 m2 m3 m4; do
    printf '%s\t%s\t%s\n' "$t" "$m" "$(braco_primeiro "$t" "$m")" >> plano.tsv
  done
done
cat plano.tsv
sha256sum plano.tsv > plano.sha256
git add plano.tsv plano.sha256 && git commit -m "batuta zero: plano sorteado" && git push
```

O plano é reprodutível: quem tiver `SEED.txt` roda os mesmos comandos e obtém
`plano.tsv` byte a byte igual. É isso que faz "sorteado" significar alguma coisa.

**2.3 Ordem das rodadas no dia.** Seguir `plano.tsv` de cima para baixo. Não pular
linha porque "essa vai demorar". Pular na hora é escolher.

---

### Passo 3 — Rodar uma rodada (repetir 40 vezes)

Cada rodada tem um identificador: `<tarefa>-<modelo>-<braco>`, por exemplo
`z-02-m3-B`.

**3.1 Diretório limpo.**

```bash
R="z-02-m3-B"                      # trocar a cada rodada
rm -rf "rodadas/$R"
mkdir -p "rodadas/$R/trabalho"
cd "rodadas/$R/trabalho"
```

**3.2 Gerar os insumos.** Rodar, em ordem, cada `gerador` da tarefa em
`tarefas.json`, com `trabalho/` como diretório corrente. Conferir:

```bash
ls -la
sha256sum * > ../INSUMOS.sha256
```

Os mesmos insumos, byte a byte, nos dois braços. Se os checksums de A e B diferirem,
a dupla está queimada e se refaz inteira.

**3.3 Sessão limpa. Sem exceção.**

- Janela nova, conversa nova, zero histórico.
- Nada de "continua daí", nada de "igual ao anterior".
- No braço A: nenhuma skill instalada e roteador desligado — conferir, não supor.
- No braço B: **apenas** as `skills_candidatas` da tarefa instaladas.
- Temperatura 0, ou o mínimo que o canal aceitar; anotar qual foi.
- Entre a rodada A e a rodada B da mesma dupla, fechar o cliente inteiro.

Conferência antes de colar o enunciado:

```bash
ls ~/.claude/skills 2>/dev/null || echo "(nenhuma skill instalada)"
```

**3.4 Colar o enunciado.** `cat ../../../tarefas/z-02.md` e colar. Nada antes,
nada depois. Sem "por favor", sem "capriche", sem "use a skill X". Se o modelo
perguntar algo, responder **apenas** com o que já está no enunciado ou nos insumos;
se a resposta não estiver lá, responder "siga o enunciado" e registrar a pergunta
em `meta.json`.

**3.5 Deixar trabalhar** até o `teto_turnos` da tarefa. Estourou sem entregar:
registra `reprovada_por_teto`. Não é descarte — é resultado.

**3.6 Guardar a saída crua.**

```bash
cd ..
mkdir -p saida
cp -a trabalho/. saida/            # todos os arquivos produzidos
# e a transcrição completa da conversa, exportada do cliente:
#   saida/transcricao.md
```

**3.7 Rodar o verificador** (tarefas `automatica` e `mista`):

```bash
cd trabalho
bash -e -c "$(python3 -c "
import json;b=json.load(open('/caminho/para/batuta/bateria/v1/tarefas.json',encoding='utf-8'))
print([t for t in b['tarefas'] if t['id']=='cod-02'][0]['verificador'])")"
echo "codigo de saida: $?"
cd ..
```

**3.8 Fechar o registro** da rodada em `meta.json` (modelo da seção 3).

**3.9 Voltar para a raiz** e ir para a próxima linha do plano.

---

### Passo 4 — Anonimizar para o julgamento cego

Julgamento cego **inclusive do Filipe**. Quem sabe qual saída é do braço com skill
encontra qualidade nela — não por má-fé, por ser humano.

**4.1 Varrer autodelação.** A saída às vezes se entrega ("como assistente da
X…", "seguindo a skill Y…"). Isso não se apaga do cru; se substitui **na cópia
cega**, e a substituição fica registrada.

```bash
grep -rniE 'skill|claude|gpt|gemini|llama|mistral|anthropic|openai' rodadas/*/saida/ \
  > cego/autodelacao.log || true
wc -l cego/autodelacao.log
```

**4.2 Gerar as cópias cegas com código opaco.**

```bash
: > mapa.tsv
for d in rodadas/*/; do
  R=$(basename "$d")
  COD=$(head -c 12 /dev/urandom | xxd -p)
  printf '%s\t%s\n' "$COD" "$R" >> mapa.tsv
  mkdir -p "cego/$COD"
  cp -a "$d/saida/." "cego/$COD/"
  # substituições da 4.1, aplicadas SÓ na cópia cega:
  grep -rlZ -iE 'skill|claude|gpt|gemini|llama|mistral|anthropic|openai' "cego/$COD" 2>/dev/null \
    | xargs -0 -r sed -i -E 's/(skill|claude|gpt|gemini|llama|mistral|anthropic|openai)/[REDIGIDO]/Ig'
done
```

**4.3 Selar o mapa antes de olhar qualquer saída.**

```bash
sha256sum mapa.tsv > mapa.sha256
git add mapa.sha256 && git commit -m "batuta zero: mapa selado antes do julgamento" && git push
mv mapa.tsv ~/.batuta-zero-mapa-selado.tsv     # fora da pasta de trabalho
chmod 400 ~/.batuta-zero-mapa-selado.tsv
```

O hash vai para o repositório **antes** do julgamento. O arquivo sai da pasta. No
fim, o mapa é publicado e qualquer pessoa confere que ele é o mesmo que foi selado.
É isso que impede a versão conveniente do mapa de aparecer depois.

**4.4 Embaralhar a ordem de julgamento, também pela semente.**

```bash
. ./SEED.txt
ls cego | grep -v autodelacao.log | LC_ALL=C sort \
  | shuf --random-source=<(openssl enc -aes-256-ctr -pass "pass:$SEED" -nosalt </dev/zero 2>/dev/null) \
  > ordem_julgamento.txt
head ordem_julgamento.txt
```

Julgar nessa ordem, de cima para baixo, sem espiar a lista inteira antes.

---

### Passo 5 — Julgar

**5.1 O que se julga.** Para cada código de `ordem_julgamento.txt`, abrir
`cego/<codigo>/`, ler a tarefa correspondente em `tarefas/` (o código não diz qual
é; o conteúdo da pasta diz) e responder **sim ou não** a cada item do
`criterio_aceite` daquela tarefa. Nada de nota geral antes dos itens.

**5.2 Gravar o veredito** em `vereditos/<codigo>.json` (modelo na seção 3).

**5.3 Não voltar atrás.** Veredito gravado não se reabre depois de o mapa ser
revelado. Se bater arrependimento, ele entra como observação pública, não como
correção.

**5.4 Só depois dos 40 vereditos**, revelar o mapa — conferindo antes que ele é o
mesmo que foi selado:

```bash
cp ~/.batuta-zero-mapa-selado.tsv mapa.tsv
sha256sum -c mapa.sha256        # tem que imprimir: mapa.tsv: OK
```

Se der `FAILED`, **a leva inteira é descartada e publicada como descartada**, com o
motivo escrito. Descarte publicado vale mais que resultado salvo.

Só com o `OK` na tela é que se junta veredito com rodada:

```bash
join -1 1 -2 1 -t $'\t' <(LC_ALL=C sort mapa.tsv) \
     <(for v in vereditos/*.json; do
         printf '%s\t%s\n' "$(basename "$v" .json)" \
           "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["aprovada"])' "$v")"
       done | LC_ALL=C sort) > resultados.tsv
cat resultados.tsv
```

---

### Passo 6 — Publicar o cru

O que separa o Batuta de um README autoproclamado: qualquer pessoa consegue
refazer o julgamento e discordar.

```bash
mkdir -p publicacao
cp -a tarefas manifesto.json SEED.txt plano.tsv mapa.tsv mapa.sha256 \
      vereditos ordem_julgamento.txt publicacao/
for d in rodadas/*/; do
  R=$(basename "$d")
  mkdir -p "publicacao/rodadas/$R"
  cp -a "$d/saida" "$d/meta.json" "$d/INSUMOS.sha256" "publicacao/rodadas/$R/"
done
python3 -c "import pathlib,hashlib;[print(hashlib.sha256(p.read_bytes()).hexdigest(), p) for p in sorted(pathlib.Path('publicacao').rglob('*')) if p.is_file()]" > publicacao/MANIFEST.sha256
git add publicacao && git commit -m "batuta zero leva 1: cru completo" && git push
```

Para cada dupla, a publicação carrega: **o enunciado + as duas saídas + o
veredito**. Mais o plano sorteado, a semente, o mapa selado e os checksums.

Encadear com o hash da publicação anterior e carimbar o topo no OpenTimestamps,
conforme §8 do dossiê.

---

## 2. O JUIZ

### 2.1 As três leis

**Lei 1 — Cego.** O juiz não sabe se a skill disparou, qual braço produziu a
saída, nem qual modelo a escreveu. Se souber, confirma o que a gente quer ouvir e o
número morre. Vale para o juiz-modelo e vale para o Filipe.

**Lei 2 — Não é o réu.** Modelo nunca julga a própria saída. Julgamento **cruzado,
sempre**. Pares da leva 1:

| saída de | julgada por |
|---|---|
| `m1` (topo pago) | `m2` |
| `m2` (média) | `m1` |
| `m3` (pequeno) | `m1` |
| `m4` (grátis/local) | `m2` |

Nenhum modelo aparece nas duas colunas da mesma linha. O juiz-modelo é da faixa
alta porque julgar é mais barato que produzir — o custo do juiz não é o gargalo.

**Lei 3 — Versionado.** Junto de **cada** veredito se grava: identificador do
modelo-juiz, versão exata servida pelo canal, **o prompt inteiro** do juiz (não um
resumo, não um link — o texto), a temperatura e o hash desse prompt. Juiz que muda
sem changelog invalida a série histórica inteira, retroativamente.

Toda vez que o prompt do juiz mudar: nova versão (`juiz-v1` → `juiz-v2`), entrada
no changelog, e as séries anteriores continuam marcadas com a versão antiga. Não se
recalcula o passado com o juiz novo — se recalcula e se publica **as duas** séries,
declarando qual é qual.

**Juiz é sinal, não verdade.** Ele entra ao lado dos proxies duros (reprompt, erro,
retry, código de saída do verificador). Onde o verificador reprova, o juiz não é
consultado: saída que falhou no objetivo não se salva na conversa.

### 2.2 Rubrica por categoria

A rubrica não substitui o `criterio_aceite` — ela vem **depois** dele. Primeiro o
juiz responde sim/não a cada critério; a rubrica só é aplicada às saídas que
passaram em todos os critérios, para separar o que é "cumpriu" do que é "cumpriu
bem". Cada eixo vale 0, 1 ou 2.

**`codigo`** — o verificador já disse se passa. A rubrica olha o resto:
1. *Sobrevivência*: trata entrada vazia, limite e tipo errado sem quebrar.
2. *Legibilidade*: um humano acha o defeito em menos de 2 minutos.
3. *Contenção*: não reescreveu o que não foi pedido, não trouxe dependência nova.

**`escrita`**:
1. *Fidelidade factual*: nenhum fato entrou, saiu ou mudou de valor.
2. *Serve ao leitor declarado*: o destinatário do enunciado entende sem reler.
3. *Densidade*: cada frase carrega informação; nenhuma existe só para soar bem.

**`dados`**:
1. *Número certo*: bate com o recomputado a partir do insumo.
2. *Método declarado*: dá para refazer a conta lendo o que ele escreveu.
3. *Tratamento de borda*: empate, ausente, duplicata e valor impossível ganharam
   decisão explícita.

**`documentos`**:
1. *Formato real*: o arquivo abre no programa de destino, não é outra coisa com a
   extensão trocada.
2. *Estrutura pedida*: seções, ordem e contagens conforme o enunciado.
3. *Rastreabilidade*: todo campo preenchido tem origem apontável no insumo.

**`pesquisa`**:
1. *Ancoragem*: toda afirmação carrega de onde saiu.
2. *Declara a lacuna*: o que o material não responde aparece como não respondido,
   em vez de ser preenchido com plausibilidade.
3. *Tensão vista*: onde as fontes discordam, a discordância é nomeada, não
   suavizada.

**`automacao`**:
1. *Idempotência*: rodar duas vezes não estraga nada.
2. *Falha visível*: quebra com código de saída != 0 e mensagem no lugar certo.
3. *Retomada*: o estado permite continuar de onde parou, sem refazer o já feito.

Escala final por saída: `aprovada` (todos os critérios sim) ou `reprovada` (algum
não), mais o total da rubrica de 0 a 6. **A aprovação é o número principal.** A
rubrica é desempate e só aparece publicada ao lado da aprovação, nunca sozinha.

### 2.3 O que se grava junto do veredito

```json
{
  "juiz": {
    "modelo": "PREENCHER",
    "versao_servida": "PREENCHER",
    "canal": "openrouter",
    "temperatura": 0,
    "prompt_versao": "juiz-v1",
    "prompt_sha256": "PREENCHER",
    "prompt_integral": "PREENCHER — o texto inteiro, sem corte"
  }
}
```

Veredito sem `prompt_integral` não entra no dataset. Não há exceção "o prompt é
longo".

---

## 3. Modelos de registro

### 3.1 `rodadas/<id>/meta.json` — uma por rodada

```json
{
  "rodada_id": "z-02-m3-B",
  "leva": "batuta-zero-1",
  "bateria": "batuta.bateria.v1@1.0.0",
  "tarefa_bateria": "cod-02",
  "tarefa_zero": "z-02",
  "categoria": "codigo",
  "complexidade": "media",
  "modelo": "m3",
  "modelo_id_canal": "PREENCHER",
  "modelo_versao_servida": "PREENCHER",
  "canal": "openrouter",
  "temperatura": 0,
  "braco": "B",
  "braco_nome": "com-skill",
  "ordem_na_dupla": 1,
  "ordem_sorteada_por": "sha256(SEED|tarefa|modelo)",
  "skills_instaladas": [{"nome": "systematic-debugging", "versao": "PREENCHER"}],
  "skills_que_dispararam": ["systematic-debugging"],
  "roteador": {"ativo": true, "versao": "PREENCHER", "holdout_causal": false},
  "sessao_limpa": true,
  "insumos_sha256": "conteudo de INSUMOS.sha256",
  "enunciado_sha256": "PREENCHER",
  "turnos_usados": 3,
  "teto_turnos": 5,
  "reprompts": 1,
  "erros_de_ferramenta": 0,
  "tokens_entrada": 0,
  "tokens_saida": 0,
  "custo_usd": 0.0,
  "duracao_s": 0,
  "verificador_codigo_saida": 0,
  "desfecho": "aprovada | reprovada | reprovada_por_teto | erro_de_infra",
  "perguntas_do_modelo": [],
  "incidentes": []
}
```

### 3.2 `vereditos/<codigo>.json` — um por saída cega

```json
{
  "codigo_cego": "PREENCHER",
  "tarefa_zero": "z-02",
  "julgado_em": "2026-09-03",
  "julgado_por": "humano-cego | modelo-cruzado",
  "criterio_aceite": [
    {"n": 1, "texto": "caixa.py continua expondo total(itens, cupom=None).", "resposta": "sim"},
    {"n": 2, "texto": "total([(5000, 2)]) devolve 9000.", "resposta": "sim"}
  ],
  "aprovada": true,
  "rubrica": {"eixo_1": 2, "eixo_2": 1, "eixo_3": 2, "total": 5},
  "observacao_livre": "",
  "juiz": {
    "modelo": "PREENCHER",
    "versao_servida": "PREENCHER",
    "prompt_versao": "juiz-v1",
    "prompt_sha256": "PREENCHER",
    "prompt_integral": "PREENCHER"
  }
}
```

### 3.3 Planilha de acompanhamento (as 40 linhas)

Uma linha por rodada. Colunas, nesta ordem:

```
rodada_id | tarefa_zero | tarefa_bateria | categoria | complexidade | modelo |
faixa | canal | braco | ordem_na_dupla | sessao_limpa | skills_instaladas |
skills_que_dispararam | turnos_usados | teto_turnos | reprompts |
verificador_codigo_saida | desfecho | codigo_cego | aprovada | rubrica_total |
tokens_entrada | tokens_saida | custo_usd | duracao_s | incidentes
```

Exportar como CSV. `codigo_cego` e `aprovada` só se preenchem **depois** do passo
5.4 — enquanto o julgamento corre, essas duas colunas ficam vazias na planilha e o
arquivo não é aberto durante o julgamento.

**O número que interessa no fim** não é "quantas aprovadas". É, por faixa de
modelo: `aprovadas(B) − aprovadas(A)`, e o **custo por tarefa concluída** em cada
braço. Skill pode encarecer a chamada e baratear a tarefa, matando reprompts. É
essa a métrica que ninguém publica.

---

## 4. O que NUNCA pode acontecer

Cada item abaixo, se acontecer, **contamina a leva**. A regra é a mesma para todos:
para, registra o incidente e refaz o que couber — nunca "segue e depois a gente
menciona".

**Contaminação**
1. Reaproveitar sessão, aba, contexto ou histórico entre duas rodadas.
2. Rodar o braço B logo depois do A na mesma janela, sem fechar o cliente.
3. Colar o enunciado com qualquer palavra a mais ou a menos.
4. Responder a uma pergunta do modelo com informação que não está no enunciado nem
   nos insumos.
5. Ajudar durante a rodada: corrigir, apontar erro, sugerir caminho.
6. Deixar skill instalada no braço A, ou skill fora das `skills_candidatas` no
   braço B.
7. Insumos diferentes entre A e B da mesma dupla (checar `INSUMOS.sha256`).
8. Rodar a mesma dupla em dias com versões diferentes do mesmo modelo, sem registrar.

**Rótulo visível**
9. Julgar sabendo qual braço, qual modelo ou qual ordem produziu a saída.
10. Nomear pasta, arquivo ou aba do julgamento com braço, modelo ou "com/sem".
11. Abrir `mapa.tsv` — ou a planilha de acompanhamento — antes do último veredito.
12. Deixar a saída se autodelatar na cópia cega sem passar pela varredura da 4.1.
13. Julgar as duas saídas da mesma dupla em sequência: o embaralhamento existe para
    isso.

**Mexer na régua no meio**
14. Editar enunciado, insumo, critério de aceite ou verificador depois da primeira
    rodada da série.
15. Trocar a semente, o plano ou a ordem sorteada depois de publicados.
16. Acrescentar ou remover tarefa no meio da leva.
17. Mudar o prompt do juiz durante o julgamento das 40.
18. Reabrir veredito depois de o mapa ter sido revelado.

**Publicação**
19. Publicar número sem publicar o cru que o sustenta.
20. Publicar rodada descartada como se não tivesse existido: descarte vai publicado,
    com o motivo escrito.
21. Publicar resultado sem canal, versão da bateria e versão do juiz.

---

## 5. Holdout causal

Skill que aparece junto de bom resultado mostra correlação. Para medir **causa**,
alguém precisa não receber a skill sem que isso dependa de quem é o usuário. É o
grupo de controle.

**Como funciona.** Em **5% dos turnos**, escolhidos por sorteio no momento do
turno, o roteador **se cala de propósito**: não propõe skill nenhuma, mesmo tendo
casamento claro. O turno é marcado `holdout: true` no evento e entra no dataset como
controle.

**Condições, todas obrigatórias:**

1. **Declarado na cara do usuário.** Uma frase na primeira execução, e não escondida
   em documentação: *"Em 5% dos turnos o Batuta fica calado de propósito, para medir
   se a skill ajuda de verdade. Isso é o que torna o número honesto. Você pode
   mudar a porcentagem ou desligar em `~/.batuta/config.json`."*
2. **Configurável.** `holdout_pct` aceita qualquer valor de 0 a 100.
3. **Desligável.** `holdout_pct = 0` desliga, e desligar não degrada nada além do
   próprio holdout.
4. **Marcado no dado.** Todo turno em holdout sobe marcado como tal. Turno de
   holdout que não estiver marcado é dado corrompido.
5. **Nunca silencioso.** Experimento escondido destrói o projeto — é o item 1 dos
   riscos declarados. Se a declaração não couber na interface, o holdout não roda.

**Configuração:**

```json
{
  "holdout_pct": 5,
  "holdout_semente": "por-instalacao, gerada localmente",
  "holdout_declarado_em": "primeira execucao"
}
```

**No Batuta Zero, o holdout fica desligado** (`manifesto.json`, campo
`holdout_causal`). O Zero já é um experimento controlado por construção: os dois
braços são o controle. O holdout existe para a frota, onde não há como pedir que
cada usuário rode a tarefa duas vezes.

**Como se lê o número.** Dentro da mesma instalação, mesmo perfil de uso e mesma
janela de tempo, compara-se desfecho dos turnos `holdout: true` com desfecho dos
turnos em que o roteador falou. A diferença é atribuível ao roteamento, não ao
tipo de usuário — que é exatamente o que a comparação entre usuários não consegue
dizer.

---

## 6. Checklist de bolso

Antes de cada rodada:

- [ ] `sha256sum -c tarefas/CHECKSUMS.txt` passou
- [ ] próxima linha do `plano.tsv`, sem pular
- [ ] diretório da rodada recriado do zero
- [ ] insumos gerados e com checksum igual ao do outro braço
- [ ] cliente fechado e reaberto; sessão nova
- [ ] skills conferidas com `ls`, não supostas
- [ ] enunciado colado sem uma palavra a mais

Antes de julgar:

- [ ] 40 rodadas fechadas, com `meta.json` preenchido
- [ ] varredura de autodelação rodada e registrada
- [ ] `mapa.sha256` commitado e o mapa fora da pasta de trabalho
- [ ] `ordem_julgamento.txt` gerado pela semente
- [ ] planilha de acompanhamento fechada

Antes de publicar:

- [ ] `sha256sum -c mapa.sha256` confere
- [ ] cru completo: enunciado + as duas saídas + veredito, para as 20 duplas
- [ ] descartes publicados com motivo
- [ ] prompt integral do juiz junto de cada veredito
- [ ] canal, versão da bateria e versão do juiz em toda linha
- [ ] hash encadeado com a publicação anterior e carimbo OpenTimestamps

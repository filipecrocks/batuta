# SPEC — o contrato do caminho quente

Este documento e `crates/batuta/tests/conformidade.rs` são **o contrato**. Um porte
para outra linguagem está conforme quando passa a bateria com os mesmos números —
não com números parecidos.

Versão do contrato: **1** · congelado em 24/08/2026.

---

## 1. A fronteira

**O binário só faz o que precisa ser determinístico, local e em milissegundos. Todo o
resto é skill — e como skill, é medido.**

| | caminho quente | caminho frio |
|---|---|---|
| comandos | `route`, `log`, `index` | `report`, `resumo`, `find`, `conflicts` |
| rede | **proibida** | permitida (mas não no binário — ver §7) |
| LLM | **proibido** | permitido |
| orçamento | 100ms, teto duro 300ms | sem orçamento |

Decompor tarefa em blocos, formatar entrega, reescrever prompt — nada disso entra no
binário. Viram skills candidatas e passam pelo teste como qualquer outra.

## 2. Tokenização

Um único caminho para indexar e para consultar. Se as duas pontas divergirem, o
roteador mente.

1. Dobra para minúscula e **remove acento** (á→a, ç→c, ñ→n, …).
2. Quebra em qualquer caractere não alfanumérico.
3. Descarta token com menos de 2 caracteres.
4. Descarta **palavra-cola** (lista fixa pt+en no código; sem ela o corte de ruído vira
   decoração).
5. Descarta token só de dígitos.
6. Para token com **mais de 5** caracteres, emite também o **prefixo de 5**.

O passo 6 substitui o stemmer. "quebrou" e "quebrado" se encontram em "quebr", e o
custo é uma fatia de string em vez de tabela de sufixos no caminho quente. Palavra de
5 caracteres ou menos **não** ganha prefixo — senão "casa" e "caso" viram a mesma
coisa.

## 3. Indexação

Um documento por `SKILL.md` encontrado. O saco de palavras é:

```
nome + nome-da-pasta   × 3
descrição              × 2
corpo (400 termos)     × 1
```

O corpo entra por causa do paper **SkillRouter** (arXiv 2603.22455): rankear só por
nome + descrição derruba a acurácia de roteamento em **31 a 44 pontos percentuais**
num benchmark de ~80 mil skills sobrepostas. No caminho quente local (10 a 100
skills) a diferença provavelmente some; em `batuta find`, sobre registro público,
muda tudo. Custa nada indexar os dois lados igual, e evita o furo lá na frente.

O corte de 400 termos do corpo é o segundo cinto: o `B=0.75` do BM25 já penaliza
documento comprido.

### Formato do índice — `~/.batuta/indice.txt`

Uma linha por registro, não JSON. Motivo medido: o caminho quente tem 100ms de
orçamento **inteiro**, e só as linhas `P` dos termos da consulta precisam ser
abertas. JSON obrigaria a parsear o arquivo todo.

```
BATUTA-INDICE 1
G <epoch de geração>
N <número de skills>
A <tamanho médio dos documentos>
S <i>\t<nome>\t<versão>\t<descrição>\t<caminho>\t<origem>\t<tam>
P <termo>\t<i>:<tf>,<i>:<tf>,...
```

`df` de um termo = número de pares na sua linha `P`.

## 4. Pontuação — BM25

```
idf(t)   = ln(1 + (N - df + 0.5) / (df + 0.5))
score(d) = Σ_t idf(t) · (tf · (K1+1)) / (tf + K1 · (1 - B + B · |d|/avgdl))
```

| parâmetro | valor | por quê |
|---|---|---|
| `K1` | **1.5** | padrão; validado no v0.1 |
| `B` | **0.75** | padrão; penaliza documento comprido |
| `CORTE_RUIDO` | **2.0** | com 3.2 o roteador ficava mudo em 3 de 7 casos legítimos |
| `MAX_SUGESTOES` | **3** | cada skill custa ~53 tokens no contexto |
| `FRACAO_DO_TOPO` | **0.55** | quem não chega a 55% da primeira não acompanha |

Termo repetido na consulta conta **uma vez**. Ordenação: nota decrescente, empate
resolvido por índice crescente — determinismo é requisito, não conveniência.

**Silêncio no ruído.** Turno sem casamento claro = roteador calado. Falso positivo
custa mais que falso negativo: skill sugerida à toa entra no contexto, gasta token e
ensina o modelo a ignorar a sugestão.

## 5. Holdout causal

Em `holdout_pct`% dos turnos (padrão **5**) o roteador se cala de propósito.

```
h = sha256(sal_local ‖ 0x1F ‖ "holdout|" ‖ prompt)
cai_no_holdout = (primeiros 4 hex de h, como u32) % 100 < holdout_pct
```

Determinístico de propósito: a mesma pergunta cai sempre no mesmo braço, então não dá
para tentar de novo até o roteador falar.

Condições inegociáveis: **declarado** na cara do usuário na primeira execução,
**configurável**, **desligável**. Experimento escondido destrói o projeto.

## 6. Privacidade — o que é gravado

O evento de rota grava:

| campo | o que é |
|---|---|
| `prompt_hash` | 32 hex de `sha256(sal_local ‖ 0x1F ‖ prompt)` |
| `prompt_len` | número de caracteres |
| `termos` | quantos termos sobraram da tokenização |
| `holdout`, `modo`, `ms`, `sugestoes` | metadados da decisão |

**O texto do prompt nunca é gravado nem transmitido.** O sal é gerado uma vez, fica em
`~/.batuta/sal` com permissão 0600 e **nunca é enviado** — sem ele, ninguém consegue
testar um palpite de prompt contra o hash publicado.

O que sobe (e só com opt-in explícito) é o **resumo diário agregado por skill**,
schema `batuta.resumo_diario.v1` — nunca evento cru. 200 turnos/dia viram ~20 linhas.

## 7. Rede

**O binário não acessa a rede. Nunca.** Quem baixa o registro público é o wrapper npm
(`batuta registro atualizar`); o binário só lê o arquivo em cache. Isso mantém o
caminho quente auditável por inspeção: não existe socket para revisar.

## 8. Transportes — um cérebro, três bocas

1. **Hook `UserPromptSubmit`** — principal. Determinístico; o stdout entra no contexto;
   bloqueia o turno; timeout descarta a saída inteira. Por isso o hook sai calado com
   código 0 quando qualquer coisa dá errado.
2. **MCP** — chat e Cowork, onde não há hook. O dado nasce marcado `modo: degradado`.
3. **Skill** — fallback mais fraco.

## 9. O funil

```
route  →  activate  →  outcome
```

- **route** — o Batuta propôs
- **activate** — a skill disparou de verdade (`PostToolUse` na tool Skill; o evento OTEL
  `claude_code.skill_activated` distingue usuário de modelo)
- **outcome** — o turno terminou bem? Proxies duros (reprompt, erro, retry), voto de uma
  tecla, juiz noturno

Métricas: taxa de disparo (`activate ÷ route`) · skill fantasma (0 activate em N
turnos) · lift contra o holdout · **custo por tarefa concluída** — a métrica que
ninguém tem, porque uma skill pode encarecer a chamada e baratear a tarefa matando
reprompts.

## 10. A bateria

`crates/batuta/tests/conformidade.rs`, 15 testes, rodados com `--test-threads=1`.

| # | o que trava |
|---|---|
| c01 | sha256 contra vetores conhecidos, inclusive multi-bloco |
| c02 | acento dobrado, palavra-cola fora, número solto fora |
| c03 | prefixo de 5, e palavra curta **sem** prefixo |
| c04 | frontmatter com continuação indentada |
| c05 | índice sobrevive à ida e volta do disco; leitura parcial materializa só os termos pedidos |
| c06 | 5 consultas legítimas ranqueiam a skill certa em primeiro |
| c07 | 5 ruídos deixam o roteador calado |
| c08 | K1, B, corte, teto e 400 termos congelados |
| c09 | determinismo |
| c10 | holdout determinístico e na faixa (5% ± amostra em 2000 sorteios) |
| c11 | o prompt não aparece no evento, e o hash muda com o sal |
| c12 | o resumo diário não carrega hash de prompt nem id de turno |
| c13 | JSON canônico (chaves ordenadas) e ida e volta |
| c14 | data UTC |
| c15 | 506 skills dentro do orçamento |

Medido em 24/08/2026, nesta máquina: **506 skills indexadas em 91ms**, **50 rotas em
136ms no total** (~2,7ms por rota, subida de processo incluída), índice de 397 KB.

## 11. O que o v0.1 em Node ensinou

O algoritmo rodava em 2ms. A **subida do processo Node era ~200ms** — sozinha, estourava
o orçamento do hook. Daí o binário Rust estático (subida de 1 a 3ms) e o pacote npm
como wrapper fino.

Se um dia 300ms não bastar, o plano B é daemon com socket unix. É plano B, não A.

# Bateria canônica v1

24 tarefas congeladas em `tarefas.json`. Enunciado, insumos, critério de aceite e
verificador entram no repositório como código: versionados, imutáveis dentro da
versão, revisáveis por qualquer pessoa.

- `schema`: `batuta.bateria.v1`
- `versao`: `1.0.0`
- `congelada_em`: `2026-08-24`

---

## Por que congelar

Sem bateria congelada, nenhum número é comparável — e um número não comparável é
marketing.

Três coisas quebram quando a tarefa muda no meio:

1. **A série histórica morre.** Se o enunciado de hoje não é o de ontem, a
   diferença medida entre dois modelos pode ser só a diferença entre dois textos.
2. **O experimento vira torcida.** Quem escreve a tarefa depois de ver a saída
   escreve a tarefa que a saída vence. É exatamente o vício que a §2 do dossiê
   documenta no mercado: cada roteador marca o próprio gol com a própria régua.
3. **O critério de aceite deixa de ser critério.** Critério escrito depois é
   racionalização.

Por isso: **critério de aceite nasce junto da tarefa**, antes de qualquer rodada,
e cada critério é respondível com sim ou não por alguém que não viu a saída ser
gerada. Nada de "bem escrito", "de qualidade", "adequado".

---

## O que tem dentro de cada tarefa

```json
{
  "id": "cod-02",
  "categoria": "codigo",
  "complexidade": "media",
  "titulo": "...",
  "enunciado": "texto EXATO enviado ao modelo, idêntico nos dois braços",
  "insumos": [{"nome": "...", "descricao": "...", "gerador": "comando shell determinístico"}],
  "criterio_aceite": ["...", "..."],
  "verificacao": "automatica | juiz | mista",
  "verificador": "comando de shell que sai 0 (aprovado) ou != 0 (reprovado)",
  "skills_candidatas": ["systematic-debugging", "test-driven-development"],
  "teto_turnos": 5,
  "observacao": "o que a tarefa está medindo de fato"
}
```

Regras que a bateria v1 obedece e que qualquer versão futura tem de obedecer:

- **6 categorias × 4 tarefas = 24.** Em cada categoria: 1 simples, 2 médias, 1
  complexa. Categorias: `codigo`, `escrita`, `dados`, `documentos`, `pesquisa`,
  `automacao`.
- **As 4 tarefas de `codigo` são `automatica`**, com verificador real (teste que
  passa ou não passa). É o que torna a Fase 1 quase grátis.
- **O enunciado nunca cita skill.** Nada de "use a skill X". O braço com skill se
  distingue pelo ambiente, nunca pelo texto. Enunciado idêntico, palavra por
  palavra, nos dois braços.
- **Enunciado curto**: 2 a 8 linhas. Tarefa complexa ganha mais insumo, não mais
  prosa.
- **Zero rede, zero conta em serviço externo, zero data corrente.** Onde a data
  importa (`aut-03`), ela entra por variável de ambiente (`DATA_REF`), não por
  `date` do sistema.
- **`skills_candidatas` é hipótese declarada**, não instrução: é o que a tarefa
  *deveria* acionar. Quando o roteador não aciona nenhuma delas e o resultado sobe
  assim mesmo, isso também é dado.

### Distribuição da v1

| categoria | simples | médias | complexa | verificação |
|---|---|---|---|---|
| `codigo` | cod-01 | cod-02, cod-03 | cod-04 | 4 automáticas |
| `escrita` | esc-01 | esc-02, esc-03 | esc-04 | 3 mistas, 1 juiz |
| `dados` | dad-01 | dad-02, dad-03 | dad-04 | 4 mistas |
| `documentos` | doc-01 | doc-02, doc-03 | doc-04 | 4 mistas |
| `pesquisa` | pes-01 | pes-02, pes-03 | pes-04 | 2 mistas, 2 juiz |
| `automacao` | aut-01 | aut-02, aut-03 | aut-04 | 4 mistas |

Total: 4 automáticas, 17 mistas, 3 só juiz.

---

## Como rodar

**Pré-requisitos do ambiente da rodada:** `bash`, `python3` (3.11+, só biblioteca
padrão), `make`, `tar`, `unzip`. Nada mais. Sem rede.

Cada rodada é um diretório vazio, próprio, descartável. O ciclo é sempre o mesmo:

1. **Preparar o diretório.** Rodar, em ordem, cada `gerador` dos `insumos` da
   tarefa, com o diretório da rodada como diretório corrente. O gerador é
   determinístico: mesmo comando, mesmo byte.
2. **Entregar o enunciado.** Enviar `enunciado` ao modelo, sem uma palavra a
   mais. O ambiente do braço (com skill / sem skill / com receita) é a única
   diferença entre as rodadas da mesma tarefa.
3. **Deixar trabalhar** até o `teto_turnos`. Estourou o teto sem entregar: a
   rodada é registrada como reprovada por teto, não descartada.
4. **Verificar.** Rodar o `verificador` com `bash -e`, com o diretório da rodada
   como diretório corrente e os insumos já presentes. Saída `0` = aprovado.
5. **Julgar**, quando `verificacao` for `juiz` ou `mista`, seguindo
   `docs/PROTOCOLO.md` — cego, cruzado, versionado.
6. **Registrar o cru**: enunciado, insumos, saída, código de saída do verificador,
   veredito do juiz, tokens, custo, turnos.

O verificador cobre o que é contável. O juiz cobre o resto do `criterio_aceite`.
Em tarefa `mista`, **verificador reprovado encerra a rodada**: não se pede ao juiz
que salve saída que já falhou no objetivo.

### Fase 1: só a fatia `codigo`

A Fase 1 roda **apenas as 4 tarefas de `codigo`**, e só depois abre para o resto.
O motivo é o do dossiê (§12): o juiz de código é quase grátis, porque teste passa
ou não passa. Validar o método no terreno objetivo antes de gastar julgamento em
terreno subjetivo é o que separa medição de opinião.

Ordem de abertura das fatias, depois da 1: `dados` e `automacao` (verificador
forte), depois `documentos`, depois `escrita` e `pesquisa`.

---

## Braço

Braço é **o que muda no ambiente**, com o enunciado parado. A v1 prevê três:

| braço | o que está ligado |
|---|---|
| `sem-nada` | modelo puro, nenhuma skill instalada, roteador calado |
| `com-skill` | apenas as `skills_candidatas` da tarefa instaladas e roteáveis |
| `com-receita` | a receita inteira instalada (6-10 skills fixadas em versão, §5) |

A matriz principal roda **2 braços** — `sem-nada` e `com-skill`. `com-receita`
entra quando existir receita publicada com evidência colada.

Registrar, em toda rodada: qual braço, quais skills estavam instaladas, qual
disparou de fato (`activate`), e a versão de cada uma. Skill instalada que não
disparou é skill fantasma, e isso é um resultado — não um erro de execução.

---

## A regra "canal não multiplica" (§7, regra 2)

A matriz principal roda **num canal só**: OpenRouter, API unificada. Não se
multiplica a matriz por canal.

O motivo é aritmético e de higiene. Aritmético: 24 tarefas × 2 braços × 6 modelos
já são ~300 rodadas/mês; multiplicar por 4 canais leva a 1.200 e nada fica
comparável com nada. De higiene: o canal muda temperatura padrão, janela de
contexto efetiva, versão servida e limite de saída, e nenhuma dessas coisas é o
que a bateria quer medir.

Canal vira **teste separado e declarado**: mesma tarefa, mesmo modelo, mesmo
braço, canais diferentes (assinatura, API direta, OpenRouter, OpenCode…). Se
aparecer diferença, ela é notícia por si — e é publicada como tal, não misturada
ao número principal.

Toda linha publicada carrega o canal. Um número sem canal declarado não entra no
dataset.

---

## A conta

```
24 tarefas × 2 braços × 6 modelos ≈ 288 rodadas/mês
```

Arredondando com as repetições de desempate: **≈ 300 rodadas/mês**, algumas dezenas
de dólares via API.

Modelos da v1, por faixa (o nome exato de cada um vive no manifesto da rodada, não
aqui — modelo troca, faixa não): 2 de topo pago, 2 de faixa média, 1 pequeno,
1 grátis/local.

Fase 1, só `codigo`: `4 × 2 × 6 = 48 rodadas`, e 48 verificações automáticas — sem
custo de juiz.

---

## Rotação mensal

Todo mês: **entram 5 tarefas, saem 5, com changelog.** Casa com o ciclo de 5 skills
novas por mês.

Regras da rotação:

1. **A versão sobe.** `1.0.0` → `1.1.0` a cada rotação. Correção de erro material
   num enunciado ou verificador sobe o patch (`1.0.1`) e é anunciada como
   correção, nunca aplicada em silêncio.
2. **A forma se mantém.** Depois da rotação continua sendo 6 categorias × 4
   tarefas, 1 simples / 2 médias / 1 complexa em cada. Sai uma média, entra uma
   média.
3. **Quem sai, sai por motivo escrito.** Motivos válidos: saturou (todos os braços
   passam ou todos falham, não discrimina mais), vazou (o enunciado apareceu em
   corpus público), quebrou (o verificador depende de algo que mudou no ambiente),
   ou virou ambígua na prática.
4. **Tarefa aposentada não é apagada.** Ela sai da bateria ativa e fica no
   `CHANGELOG.md` com a versão em que entrou e a versão em que saiu. Os resultados
   antigos continuam válidos para a faixa de versões em que ela estava ativa.
5. **Nunca se rotaciona no meio de uma série.** Rotação acontece na virada da
   versão, com todas as rodadas da versão anterior fechadas.

Cada entrada de `CHANGELOG.md` traz: versão, data, tarefas que entraram (com id,
categoria, complexidade e origem), tarefas que saíram (com motivo), e o hash do
`tarefas.json` da versão anterior — a mesma cadeia de hash do §8 do dossiê.

---

## Como uma tarefa nova entra

Vinda da arena (§10), sempre pelo mesmo funil:

```
Envio → Triagem → Canonização → Voto → Teste → Publicação
```

- **Triagem.** Dedupe, segurança, nada de executável escondido, nada que precise
  de rede ou de conta. Sai daqui só o que é reproduzível numa máquina desligada da
  internet.
- **Canonização — a porta que importa.** *Tarefa enviada NUNCA roda como chegou.*
  É reescrita no formato desta bateria: enunciado autocontido de 2 a 8 linhas,
  insumos com gerador determinístico, critério de aceite verificável, categoria,
  complexidade, verificador quando der. Quem envia sugere o problema; **a régua é
  nossa** — autor de skill manda a tarefa que a skill dele vence.
- **Voto.** Decide a fila de teste, nunca o resultado. Voto ≠ nota.
- **Ensaio antes de entrar.** Toda tarefa candidata roda uma vez em cada braço,
  fora da bateria, contra pelo menos 2 modelos de faixas diferentes. Se todos
  passam ou todos falham, ela não discrimina e volta para a fila de reescrita.
- **Verificador antes do congelamento.** Nenhuma tarefa entra sem que o
  verificador tenha sido testado nos dois sentidos: aprovar uma solução de
  referência correta **e** reprovar uma solução ausente ou errada. Verificador que
  só foi testado no caso feliz não é verificador.
- **Entrada.** Só na próxima virada de versão, no lugar de uma tarefa que saiu, com
  crédito nominal a quem enviou no `CHANGELOG.md` e no dataset.

---

## O que nunca pode acontecer nesta pasta

- Editar `enunciado`, `insumos`, `criterio_aceite` ou `verificador` de `1.0.0`
  depois da primeira rodada publicada. Mudou, é outra versão.
- Enunciado que cite skill, roteador, marca de modelo ou o próprio Batuta.
- Critério de aceite que precise de opinião para ser respondido.
- Tarefa que dependa de rede, de credencial ou da data de hoje.
- Verificador que leia o nome do braço, do modelo ou qualquer rótulo. O
  verificador vê arquivos, e só.
- Resultado publicado sem canal, sem versão da bateria e sem versão do juiz.

---

## Arquivos

```
bateria/v1/
├── tarefas.json    # as 24 tarefas congeladas
└── README.md       # este arquivo
```

O protocolo de execução, o julgamento cego e o holdout causal estão em
`docs/PROTOCOLO.md`.

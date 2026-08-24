# registros/ — a corrente

Esta pasta é o cartório do Batuta. Cada arquivo aqui é um resultado publicado, e
cada um carrega o hash do anterior. Se alguém — nós inclusive — voltar e mudar um
número de um registro antigo, todos os registros a partir dali passam a não fechar
a conta, e qualquer pessoa vê isso em três segundos.

Não é firula criptográfica. O Batuta só tem um produto, e é credibilidade: um número
alucinado ou um registro editado em silêncio mata o projeto inteiro. A corrente
existe para que você não precise acreditar em nós.

## O que está aqui

```
registros/
  000001-resultado.json     um elo
  000002-juiz.json          o próximo
  ...
  TOPO.txt                  o hash do último elo, sozinho, numa linha
  TOPO.txt.ots              o carimbo de tempo do OpenTimestamps sobre o TOPO.txt
```

Cada arquivo tem esta forma:

```json
{
  "tipo": "resultado",
  "corpo": { "...": "o conteúdo publicado, incluindo tipo e criado_em" },
  "hash_anterior": "hash do registro anterior (null no primeiro)",
  "hash": "sha256 deste elo",
  "criado_em": "2026-08-24T02:19:58Z"
}
```

`tipo` e `criado_em` aparecem duas vezes de propósito: fora, para o arquivo ser
legível de bater o olho; dentro do `corpo`, que é o que está lacrado. Se as duas
cópias divergirem, a verificação acusa — não dá para adiantar a data de um registro
sem quebrar o hash.

## Como você verifica isto sozinho

Sem instalar nada além do Node (a verificação não pode ter dono):

```sh
git clone <repo do batuta> && cd batuta
node script/cadeia.mjs verificar
```

A saída é uma de duas. Ou:

```
corrente inteira: 128 registro(s), nenhum elo quebrado.
topo: ff50bf42b766207112023550ddbe250fcc51214851134ec9121da90aa0e9703d
```

Ou o lugar exato onde quebrou, com o hash declarado, o recalculado e o que fazer
para descobrir quando mudou:

```
QUEBROU em 000041-resultado.json (posicao 41 de 128)
  hash declarado:   be7e6164...
  hash recalculado: 3e7b89bb...
  o CONTEUDO deste registro foi alterado depois de publicado.
  compare com o git: git log --follow -p registros/000041-resultado.json
```

### Se você não confia no nosso script

Justo — é o nosso script. A receita do hash cabe em uma frase e você reimplementa em
qualquer linguagem em vinte minutos:

> `hash = sha256( JSON canônico de {"corpo": <o corpo>, "hash_anterior": <hash anterior, ou 64 zeros no primeiro>} )`

JSON canônico é: chaves de objeto em ordem de code point, nenhum espaço em branco
entre tokens, inteiro escrito sem casa decimal, não-inteiro arredondado em 6 casas,
escapes só para `"`, `\`, quebra de linha, retorno, tabulação e controles abaixo de
0x20 (na forma `\u00XX`). É a mesma regra em três implementações independentes:
`crates/batuta/src/json.rs` (Rust), `script/cadeia.mjs` (Node) e
`portal/lib/cadeia.ts` (portal). Elas não se importam umas às outras: se divergirem,
divergem na sua frente.

## As três âncoras (e por que são três)

**1. A corrente, aqui.** Prova encadeamento: nenhum registro foi alterado depois de
ter um sucessor. Sozinha ela tem um buraco óbvio — quem controla a pasta pode
recalcular a corrente inteira do zero e reescrever a história de ponta a ponta.

**2. O histórico do git, público.** Tapa esse buraco. Reescrever a corrente inteira
exige um `push --force` que aparece no repositório, e não apaga os clones que outras
pessoas já têm nem os espelhos de quem observa. Por isso a lei do projeto é
`git commit && git push` no mesmo movimento em que o registro é anexado: registro que
existe só na máquina de quem gravou não é registro publicado.

**3. O OpenTimestamps, fora do nosso alcance.** Tapa o buraco que sobra: as datas.
Git é fácil de forjar em data (`GIT_AUTHOR_DATE` faz o que você mandar). O
OpenTimestamps carimba o `TOPO.txt` na rede Bitcoin, de graça, e nem nós conseguimos
mover essa data depois. É a diferença entre "eles dizem que mediram em agosto" e
"este hash provadamente existia em agosto".

```sh
node script/cadeia.mjs ots        # imprime os comandos e o que o carimbo prova
ots verify registros/TOPO.txt.ots # confere o carimbo você mesmo
```

## O que a corrente NÃO prova

Isto aqui importa mais que tudo que está acima, e está escrito aqui para que ninguém
possa dizer depois que a gente insinuou o contrário:

- **Não prova que o número está certo.** Prova que ele não foi editado depois de
  publicado. Um erro de método, uma tarefa mal escrita, um juiz enviesado — tudo isso
  entra na corrente e fica lá, lacrado, errado e imutável. Contra isso valem outras
  coisas: bateria congelada, holdout, juiz cego e versionado, e o cru publicado junto
  para você refazer a conta.
- **Não prova que a medição aconteceu como descrito.** Prova que a descrição não mudou.
- **Não prova que não existe gaveta.** Prova o que foi carimbado; não diz nada sobre
  um resultado ruim que nunca tenha sido anexado. O antídoto para isso não é
  criptografia, é o protocolo: rodada declarada antes de rodar, e resultado ruim
  publicado igual.
- **Não impede um erro de ser corrigido.** Impede que ele seja corrigido em silêncio.
  Correção é registro novo, do tipo `correcao`, apontando para o hash do errado. Os
  dois ficam visíveis para sempre — era esse o combinado.

## Anexar um registro

```sh
node script/cadeia.mjs anexar caminho/do/resultado.json
git add registros/ && git commit -m "registro 000129-resultado" && git push
node script/cadeia.mjs ots     # e carimbe o novo topo
```

A corrente só anda para frente. Não existe editar, não existe apagar, e o banco de
dados do portal também recusa os dois (`sql/002_cadeia.sql`) — mas o banco é cópia de
leitura. A verdade é esta pasta, o git e o carimbo.

# Batuta

**A camada aberta de medição de Agent Skills.** Mede se uma skill funciona de verdade,
a que custo e em qual modelo — e publica tudo, imutável, sem lucro.

Não é o 27º roteador do mercado. É **o juiz** — e funciona com qualquer roteador.

→ [batuta.space](https://batuta.space) · [manifesto](MANIFESTO.md) · [o contrato](SPEC.md)

---

## O problema

Existem hoje dezenas de roteadores de skill. **Nenhum deles publica dado.** Cada um
mede o próprio gol com a própria régua, e por isso nenhum consegue provar que é melhor
que o vizinho — nem que serve para alguma coisa.

Enquanto isso, quem resolve problema de verdade no mundo quase sempre não tem dinheiro
para modelo caro e não tem como saber o que funciona.

## Instalar

```sh
curl -fsSL https://batuta.space/instalar.sh | sh    # ou: npm install -g batuta
batuta index
batuta install-hooks
```

Depois de alguns turnos: `batuta report`.

**Nada sai da sua máquina.** O relatório funciona 100% offline; enviar dado agregado é
opt-in explícito. Veja [o que fica gravado](https://batuta.space/privacidade) ou rode
`batuta privacidade`.

## O que tem aqui dentro

```
crates/batuta/        binário Rust do caminho quente — sem dependência, sem rede
  src/                roteador BM25, índice invertido, registro de eventos
  tests/              a BATERIA DE CONFORMIDADE — 15 testes, o contrato do porte
portal/               Next.js estático (Vercel) — ranking, receitas, arena, registros
sql/                  schema Neon + a cadeia de hash com trigger anti-edição
schema/               JSON Schema do evento local e do resumo diário que sobe
bateria/v1/           24 tarefas congeladas com critério de aceite escrito antes
docs/PROTOCOLO.md     o protocolo do Batuta Zero e as três leis do juiz
script/cadeia.mjs     anexar, verificar e carimbar a corrente de hash
npm/                  wrapper de dez linhas que baixa o binário
hooks/                o hook UserPromptSubmit
registros/            a corrente publicada — verificável por qualquer um
```

## Números medidos

Medidos em 24/08/2026, não estimados:

| | |
|---|---|
| indexar 506 skills | **91 ms** |
| 50 rotas (subida de processo incluída) | **136 ms** no total, ~2,7 ms cada |
| tamanho do índice | 397 KB |
| bateria de conformidade | 15 de 15 verdes |

O orçamento do caminho quente é 100 ms por turno, com teto duro de 300 ms.

## As regras que não se negociam

1. **Zero lucro.** Ninguém ganha nada — fundadores nem colaboradores.
2. **O prompt nunca sai da sua máquina.** Só hash com sal local, e o sal não é enviado.
3. **O binário não acessa a rede.** Quem faz rede é o wrapper.
4. **Silêncio no ruído.** Falso positivo custa mais que falso negativo.
5. **O juiz é cego, não é réu, e é versionado.**
6. **Existe grupo de controle.** 5% dos turnos com o roteador calado de propósito,
   declarado, configurável, desligável.
7. **A corrente não se edita.** Cada resultado carrega o hash do anterior, e o topo é
   carimbado fora do nosso controle.

Detalhe de cada uma: [MANIFESTO.md](MANIFESTO.md) e [SPEC.md](SPEC.md).

## Contribuir

O que vale mais que código, nesta ordem:

1. **Instalar e ligar o envio** — amostra é o insumo escasso, não dinheiro.
2. **Mandar uma tarefa real** para a [arena](https://batuta.space/arena).
3. **Rodar o protocolo do Batuta Zero** e publicar o cru.
4. **Achar um erro no método** e abrir issue. Credibilidade é o único produto.

Portar o caminho quente para outra linguagem também vale — e o porte está conforme
quando passa `crates/batuta/tests/conformidade.rs` com os mesmos números.

## Rodar os testes

```sh
cd crates/batuta
cargo test -- --test-threads=1     # a bateria compartilha uma casa temporária
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

## Licença

MIT. Veja [LICENSE](LICENSE).

O nome de quem contribui entra no portal e no dataset — junto do número que a pessoa
ajudou a produzir, não numa lista de agradecimentos qualquer.

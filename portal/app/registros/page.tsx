import { ultimosRegistros } from "@/lib/db";

export const revalidate = 900;
export const metadata = {
  title: "Registros",
  description:
    "Cada resultado publicado carrega o hash do anterior. Alterar um registro antigo quebra a corrente na frente de todo mundo.",
};

export default async function Registros() {
  const registros = await ultimosRegistros(20);

  return (
    <section className="faixa" style={{ paddingTop: "3rem" }}>
      <div className="centro">
        <p className="olho">imutabilidade</p>
        <h1>Registros verificáveis</h1>
        <p className="linha-fina">
          Todos os resultados publicados são ancorados criptograficamente e
          verificáveis por qualquer um. Inclusive contra nós.
        </p>

        <h3>as três âncoras</h3>
        <div className="cartao">
          <h4>1. A corrente de hash</h4>
          <p>
            Cada registro publicado carrega o <span className="mono">sha256</span> do
            anterior, calculado sobre o JSON canônico (chaves em ordem alfabética, sem
            espaço). Alterar qualquer registro antigo muda o hash dele, que quebra o elo
            seguinte, que quebra o próximo — até o topo. Não dá para consertar um elo
            sem reescrever todos os que vieram depois.
          </p>
        </div>
        <div className="cartao">
          <h4>2. O histórico do git</h4>
          <p>
            A corrente vive em{" "}
            <a
              href="https://github.com/filipecrocks/batuta/tree/main/registros"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="mono">registros/</span> no repositório público
            </a>
            . Reescrever a história de um repo com forks e clones é ruidoso de um jeito
            que não passa despercebido.
          </p>
        </div>
        <div className="cartao">
          <h4>3. OpenTimestamps</h4>
          <p>
            Periodicamente o hash do topo é carimbado fora do nosso controle, ancorado na
            rede Bitcoin. É de graça e prova uma coisa específica:{" "}
            <strong>que aquele hash já existia naquela data</strong>. Blockchain de
            verdade é upgrade opcional futuro, nunca pré-requisito — os dados já
            encadeados tornam a migração trivial.
          </p>
        </div>

        <div className="aviso">
          <p>
            <strong>O que a corrente NÃO prova.</strong> Ela não prova que o número está
            certo. Prova que o número não foi editado depois de publicado. Para o número
            estar certo existem outras coisas: juiz cego, juiz versionado, grupo de
            controle, e o dado cru publicado junto para você conferir por conta própria.
          </p>
        </div>

        <h2>Últimos elos</h2>
        {registros.length === 0 ? (
          <div className="vazio-de-verdade">
            <strong>A corrente ainda não tem elo publicado.</strong>
            O primeiro registro vai ser o resultado do Batuta Zero — 5 tarefas, 4
            modelos, 2 braços, 40 rodadas, com o cru junto.
          </div>
        ) : (
          <div className="rolagem">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>tipo</th>
                  <th>quando</th>
                  <th>hash</th>
                </tr>
              </thead>
              <tbody>
                {registros.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.id}</td>
                    <td className="mono">{r.tipo}</td>
                    <td className="miudo">{new Date(r.criado_em).toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td>
                      <div className="hash">{r.hash}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3>verificar você mesmo</h3>
        <pre>
          <code>{`git clone https://github.com/filipecrocks/batuta
cd batuta
node script/cadeia.mjs verificar`}</code>
        </pre>
        <p className="miudo">
          O comando percorre a corrente inteira e diz exatamente onde ela quebra, se
          quebrar. Não precisa confiar na nossa palavra, e é esse o ponto.
        </p>
      </div>
    </section>
  );
}

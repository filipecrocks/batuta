import { skillRanking } from "@/lib/db";

export const revalidate = 3600;
export const metadata = {
  title: "Ranking",
  description:
    "Taxa de disparo, skills fantasma e custo por tarefa concluída — com o viés da amostra declarado na cara.",
};

function pct(v: number | null) {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(0)}%`;
}
function usd(v: number | null) {
  return v === null || v === undefined ? "—" : `US$ ${Number(v).toFixed(4)}`;
}

export default async function Ranking() {
  const linhas = await skillRanking({ days: 30, limit: 50, minInstallations: 3 });

  return (
    <section className="faixa" style={{ paddingTop: "3rem" }}>
      <div className="centro-largo">
        <p className="olho">últimos 30 dias</p>
        <h1>Ranking</h1>
        <p className="linha-fina">
          Quantas vezes a skill foi sugerida, quantas vezes ela realmente disparou, e
          quanto custou cada tarefa que terminou bem.
        </p>

        <div className="aviso">
          <p>
            <strong>Viés declarado.</strong> Quem instala o Batuta já se importa com
            skills. Esta amostra é voluntária e não é representativa do ecossistema —
            ela representa quem escolheu medir. O corte mínimo desta tabela é de{" "}
            <strong>3 instalações distintas</strong> por skill: linha com uma máquina só
            é anedota, e publicar anedota como ranking é exatamente o erro que este
            projeto acusa nos outros.
          </p>
        </div>

        {linhas.length === 0 ? (
          <div className="vazio-de-verdade">
            <strong>Ainda não há número publicado aqui.</strong>
            A Fase 1 está rodando: bateria congelada, binário medido, juiz definido. O
            primeiro ranking sai quando existir amostra que aguente ser publicada —
            não antes.
            <p style={{ marginTop: "1.2rem", marginBottom: 0 }}>
              <a href="/instalar">Instalar e entrar na amostra →</a>
            </p>
          </div>
        ) : (
          <div className="rolagem">
            <table>
              <thead>
                <tr>
                  <th>skill</th>
                  <th>rotas</th>
                  <th>disparo</th>
                  <th>turnos ok</th>
                  <th>custo / tarefa</th>
                  <th>instalações</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const fantasma = l.routes >= 5 && l.activations === 0;
                  return (
                    <tr key={l.skill}>
                      <td>
                        <span className="mono">{l.skill}</span>
                      </td>
                      <td>{l.routes}</td>
                      <td>{pct(l.trigger_rate)}</td>
                      <td>{pct(l.ok_rate)}</td>
                      <td>{usd(l.cost_per_task)}</td>
                      <td>{l.installations}</td>
                      <td>
                        {fantasma ? (
                          <span className="etiqueta hipotese">fantasma</span>
                        ) : (
                          <span className="etiqueta medido">medido</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <h3>como ler esta tabela</h3>
        <ul className="miudo">
          <li>
            <strong>rotas</strong> — quantas vezes o roteador sugeriu esta skill.
          </li>
          <li>
            <strong>disparo</strong> — de todas as vezes que foi sugerida, quantas ela
            de fato foi usada. Disparo baixo com muitas rotas é sinal de descrição
            enganosa, não de skill ruim.
          </li>
          <li>
            <strong>fantasma</strong> — sugerida 5 vezes ou mais e nunca usada. Ou a
            descrição promete o que ela não faz, ou ela compete com outra que ganha
            sempre. Rode <span className="mono">batuta conflicts</span>.
          </li>
          <li>
            <strong>custo / tarefa</strong> — dólares gastos dividido por tarefas que
            terminaram bem. Uma skill pode encarecer a chamada e ainda assim baratear a
            tarefa, porque mata reprompt.
          </li>
        </ul>
        <p className="miudo">
          Nada aqui é voto e nada aqui é estrela. Estrela é marketing; a régua é
          desfecho medido.
        </p>
      </div>
    </section>
  );
}

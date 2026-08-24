export const metadata = {
  title: "Créditos",
  description: "Crédito visível é o salário. Colaborador tem nome no portal e no dataset.",
};

export default function Creditos() {
  return (
    <section className="faixa" style={{ paddingTop: "3rem" }}>
      <div className="centro">
        <p className="olho">crédito visível é o salário</p>
        <h1>Créditos</h1>
        <p className="linha-fina">
          Ninguém ganha dinheiro no Batuta. O que se ganha é nome — no portal, no
          dataset e no repositório.
        </p>

        <h2>Quem construiu</h2>
        <div className="cartao">
          <h4>Filipe Pawlik Leite</h4>
          <p className="miudo">
            concepção, protocolo e o Batuta Zero ·{" "}
            <a href="https://github.com/filipecrocks" target="_blank" rel="noopener noreferrer">
              @filipecrocks
            </a>
          </p>
        </div>

        <h2>Ideias que vieram de fora</h2>
        <p>
          Este projeto não abriu nenhum repositório concorrente antes de escrever o
          próprio código. Mas ideia boa se credita, mesmo quando a implementação é
          própria:
        </p>
        <div className="rolagem">
          <table>
            <thead>
              <tr>
                <th>de onde</th>
                <th>o que</th>
                <th>licença</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono">RealTapeL/SkillPilot</td>
                <td>
                  agrupar skills parecidas e sugerir desambiguação — o comando{" "}
                  <span className="mono">conflicts</span>
                </td>
                <td>MIT</td>
              </tr>
              <tr>
                <td className="mono">SkillRouter (arXiv 2603.22455)</td>
                <td>
                  rankear por texto completo, nunca por metadado — queda medida de 31 a 44
                  pontos
                </td>
                <td>MIT</td>
              </tr>
              <tr>
                <td className="mono">Roni-quant/skill-radar</td>
                <td>silêncio no ruído como regra, não como ajuste fino</td>
                <td>—</td>
              </tr>
              <tr>
                <td className="mono">OpenTimestamps</td>
                <td>âncora externa de tempo, de graça</td>
                <td>LGPL</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>Colaboradores</h2>
        <div className="vazio-de-verdade">
          <strong>Ainda não há colaboradores externos.</strong>
          Quando houver, o nome entra aqui e no dataset — não numa lista de
          agradecimentos qualquer, mas junto do número que a pessoa ajudou a produzir.
        </div>

        <h2>Como entrar nesta lista</h2>
        <ul>
          <li>rodar o protocolo do Batuta Zero e publicar o cru</li>
          <li>escrever uma tarefa da bateria com critério de aceite que se sustente</li>
          <li>portar o caminho quente para outra linguagem e passar a bateria de conformidade</li>
          <li>achar e provar um erro no nosso método</li>
        </ul>
        <p className="miudo">
          O que não entra: quantidade de commits, tempo de casa, ou ter chegado cedo.
        </p>
      </div>
    </section>
  );
}

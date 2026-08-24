export const metadata = {
  title: "Doar",
  description: "Zero lucro, sempre. Toda doação e todo gasto são públicos.",
};

export default function Doar() {
  return (
    <section className="faixa" style={{ paddingTop: "3rem" }}>
      <div className="centro">
        <p className="olho">zero lucro. zero. sempre.</p>
        <h1>Doar</h1>
        <p className="linha-fina">
          Ninguém ganha dinheiro aqui — nem fundadores, nem colaboradores. Doação paga
          conta de API e servidor, e nada além disso.
        </p>

        <h2>Onde o dinheiro entra e sai</h2>
        <p>
          Toda doação e todo gasto são públicos, item por item. Na Fase 1 isso vive num{" "}
          <strong>Open Collective</strong>; associação formal só quando o volume
          justificar — abrir CNPJ para administrar dezenas de dólares por mês seria gastar
          doação com burocracia.
        </p>

        <div className="vazio-de-verdade">
          <strong>O Open Collective ainda não está aberto.</strong>
          Enquanto não estiver, não tem para onde doar — e a gente prefere dizer isso a
          deixar um botão bonito que não leva a lugar nenhum.
        </div>

        <h2>Para que serve o dinheiro</h2>
        <div className="rolagem">
          <table>
            <thead>
              <tr>
                <th>gasto</th>
                <th>ordem de grandeza</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>rodadas de teste da bateria (≈300 rodadas/mês via API)</td>
                <td>dezenas de dólares por mês</td>
              </tr>
              <tr>
                <td>juiz noturno (modelo de julgamento cruzado)</td>
                <td>proporcional às rodadas</td>
              </tr>
              <tr>
                <td>hospedagem do portal e do banco</td>
                <td>perto de zero, por desenho</td>
              </tr>
              <tr>
                <td>domínio</td>
                <td>uma vez por ano</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>O que você pode dar que vale mais que dinheiro</h2>
        <ul>
          <li>
            <strong>instalar e inspecionar o relatório local</strong> — não envie dados
            até existir enrollment público e política de retenção/exclusão
          </li>
          <li>
            <strong>mandar uma tarefa real</strong> para a{" "}
            <a href="/arena">arena</a>
          </li>
          <li>
            <strong>rodar o protocolo do Batuta Zero</strong> na sua máquina e publicar o
            cru
          </li>
          <li>
            <strong>achar um erro no nosso método</strong> e abrir issue — credibilidade é
            o único produto que temos
          </li>
        </ul>
      </div>
    </section>
  );
}

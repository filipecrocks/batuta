export default function NaoAchei() {
  return (
    <section className="faixa" style={{ paddingTop: "5rem" }}>
      <div className="centro">
        <p className="olho">404</p>
        <h1>Esta página não existe.</h1>
        <p className="linha-fina">
          O roteador do Batuta fica calado quando não tem casamento claro. Esta página
          está fazendo o mesmo.
        </p>
        <div className="botoes">
          <a className="botao botao-forte" href="/">
            Voltar ao começo
          </a>
          <a className="botao" href="/manifesto">
            Manifesto
          </a>
        </div>
      </div>
    </section>
  );
}

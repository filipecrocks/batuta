export const metadata = {
  title: "Instalar",
  description: "Instalação verificada por checksum e proveniência. O binário permanece offline.",
};

export default function Instalar() {
  return (
    <section className="faixa" style={{ paddingTop: "3rem" }}>
      <div className="centro">
        <p className="olho">checksum e proveniência antes de instalar</p>
        <h1>Instalar</h1>
        <p className="linha-fina">
          O Batuta é um binário Rust sem dependências de terceiros e não acessa a rede.
        </p>

        <h3>caminho 1 — curl</h3>
        <pre>
          <code>curl -fsSL https://batuta.space/install.sh | sh</code>
        </pre>
        <p className="miudo">
          O script detecta seu sistema, baixa o binário da última release do GitHub e{" "}
          <strong>confere o SHA256</strong> contra o{" "}
          <span className="mono">SHA256SUMS</span> da release e verifica a atestação de
          proveniência do GitHub. Se não bater, não instala. O GitHub CLI
          (<span className="mono">gh</span>) precisa estar instalado.
        </p>

        <h3>caminho 2 — npm (ainda indisponível)</h3>
        <pre>
          <code>não instale o pacote npm sem escopo — ele pertence a outro projeto</code>
        </pre>
        <p className="miudo">
          O wrapper deste repositório permanecerá privado até que o pacote verificado
          <span className="mono"> @filipecrocks/batuta</span> seja publicado com proveniência.
        </p>

        <h3>caminho 3 — do fonte</h3>
        <pre>
          <code>{`git clone https://github.com/filipecrocks/batuta
cd batuta/crates/batuta
cargo install --path .`}</code>
        </pre>

        <h2>Depois de instalar</h2>
        <pre>
          <code>{`batuta index           # varre suas skills e monta o índice local
batuta install-hooks   # imprime o trecho para colar no seu settings.json
batuta report          # depois de alguns turnos, o seu número`}</code>
        </pre>

        <div className="aviso">
          <p>
            O <span className="mono">install-hooks</span> <strong>não mexe</strong> no seu{" "}
            <span className="mono">settings.json</span> sozinho. Ele grava o script do
            hook e imprime o trecho para você colar. Editar o arquivo de configuração do
            seu agente sem você ver é exatamente o tipo de coisa que este projeto não
            faz.
          </p>
        </div>

        <h2>Conferir que funcionou</h2>
        <pre>
          <code>{`batuta version
batuta route "minha planilha veio bagunçada, preciso limpar as colunas"`}</code>
        </pre>
        <p className="miudo">
          Se ele ficar calado, provavelmente está certo: sem casamento claro, o roteador
          não fala. Rode <span className="mono">batuta index</span> antes, e confira que
          ele achou suas skills.
        </p>

        <h2>Desinstalar</h2>
        <pre>
          <code>{`rm -f ~/.local/bin/batuta   # ou /usr/local/bin/batuta
rm -rf ~/.batuta            # apaga índice, eventos, salt e config`}</code>
        </pre>

        <p>
          <a href="/privacidade">O que fica guardado e como funciona a API controlada →</a>
        </p>
      </div>
    </section>
  );
}

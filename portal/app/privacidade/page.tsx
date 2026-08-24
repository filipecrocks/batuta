export const metadata = {
  title: "Privacidade",
  description:
    "O prompt nunca sai da sua máquina. O que sobe é resumo diário agregado por skill — e só com opt-in explícito.",
};

export default function Privacidade() {
  return (
    <section className="faixa" style={{ paddingTop: "3rem" }}>
      <div className="centro">
        <p className="olho">o que sobe e o que não sobe</p>
        <h1>Privacidade</h1>
        <p className="linha-fina">
          Escrito para você conferir, não para você acreditar. Todo comando desta página
          roda na sua máquina e mostra exatamente o que está guardado.
        </p>

        <h2>O texto do seu prompt nunca sai daqui</h2>
        <p>
          O que o Batuta grava do seu turno é o <strong>hash</strong> do prompt, o número
          de caracteres e quantas palavras sobraram depois da limpeza. O texto, nunca.
        </p>
        <p>
          E o hash é feito <strong>com um sal local</strong> — um número aleatório gerado
          uma vez na sua máquina, guardado em{" "}
          <span className="mono">~/.batuta/sal</span> com permissão{" "}
          <span className="mono">0600</span>, que <strong>nunca é enviado</strong>. Sem o
          sal, ninguém consegue testar um palpite de prompt contra o hash. Nem nós.
        </p>

        <h2>O que fica na sua máquina</h2>
        <div className="rolagem">
          <table>
            <thead>
              <tr>
                <th>arquivo</th>
                <th>o que é</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono">~/.batuta/sal</td>
                <td>número aleatório criado uma vez, que nunca sai daí</td>
              </tr>
              <tr>
                <td className="mono">~/.batuta/index.txt</td>
                <td>nome, descrição e palavras das skills que você já tem</td>
              </tr>
              <tr>
                <td className="mono">~/.batuta/eventos.jsonl</td>
                <td>
                  uma linha por turno: hash do prompt, comprimento, skills sugeridas e se
                  você usou alguma
                </td>
              </tr>
              <tr>
                <td className="mono">~/.batuta/config.txt</td>
                <td>suas preferências</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Não fica gravado em lugar nenhum: o texto do seu prompt, a resposta do modelo,
          nome de arquivo do seu projeto, seu usuário, sua máquina.
        </p>

        <h2>O que sobe — se você deixar</h2>
        <p>
          Enviar dado é <strong>opt-in explícito</strong>. Vem desligado. Enquanto
          estiver desligado, nada sai da sua máquina — e o{" "}
          <span className="mono">batuta report</span> continua funcionando inteiro,
          offline. O valor local não é refém do upload.
        </p>
        <p>
          Se você ligar, o que sobe é o <strong>resumo diário agregado por skill</strong>{" "}
          — nunca evento cru. 200 turnos por dia viram cerca de 20 linhas, mais ou menos
          assim:
        </p>
        <pre>
          <code>{`{
  "schema": "batuta.daily_summary.v1",
  "day": "2026-08-24",
  "installation": "9f2c1ab4de77e015",
  "skills": [
    { "skill": "systematic-debugging", "routes": 12, "activations": 9,
      "turns_ok": 8, "cost_usd": 0.184, "ghost": false }
  ]
}`}</code>
        </pre>
        <p>
          Sem prompt. Sem hash de prompt. Sem identificador de turno. Sem caminho de
          arquivo. O <span className="mono">installation</span> é derivado do próprio sal,
          então não carrega seu nome, sua máquina nem sua pasta — serve só para dizer
          &ldquo;estas linhas vieram do mesmo lugar&rdquo;.
        </p>

        <h2>Confira antes de decidir</h2>
        <pre>
          <code>{`batuta privacy          # o que está guardado
batuta summary          # exatamente o que subiria, imprimido na sua tela
batuta config upload yes # só depois de ver o de cima`}</code>
        </pre>

        <h2>Apagar tudo</h2>
        <pre>
          <code>rm -rf ~/.batuta</code>
        </pre>
        <p className="miudo">
          É isso. Não tem conta, não tem login, não tem servidor guardando um espelho do
          seu histórico.
        </p>

        <h2>O holdout, declarado</h2>
        <p>
          Em 5% dos turnos o roteador <strong>se cala de propósito</strong>. Isso não é
          bug: é o grupo de controle que permite medir causa em vez de correlação. É
          declarado na primeira execução, é configurável e é desligável com{" "}
          <span className="mono">batuta config holdout 0</span>. Experimento escondido
          destrói o projeto — então ele não é escondido.
        </p>
      </div>
    </section>
  );
}

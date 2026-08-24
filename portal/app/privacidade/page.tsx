export const metadata = {
  title: "Privacidade",
  description:
    "O prompt nunca sai da sua máquina. O resumo diário desta versão é apenas uma prévia local.",
};

export default function Privacidade() {
  return (
    <section className="faixa" style={{ paddingTop: "3rem" }}>
      <div className="centro">
        <p className="olho">o que fica local e o que a API controlada aceita</p>
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
          <span className="mono">~/.batuta/salt</span> com permissão{" "}
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
                <td className="mono">~/.batuta/salt</td>
                <td>número aleatório criado uma vez, que nunca sai daí</td>
              </tr>
              <tr>
                <td className="mono">~/.batuta/index.txt</td>
                <td>
                  nome, descrição, termos e localizadores relativos das skills que você já
                  tem; nunca o prefixo do seu diretório pessoal ou projeto
                </td>
              </tr>
              <tr>
                <td className="mono">~/.batuta/events.jsonl</td>
                <td>
                  linhas de transição por turno: <span className="mono">turn_id</span> local,
                  tempos, hash e comprimento do prompt, skills sugeridas, ativação e
                  resultado desconhecido quando não há recibo confiável
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
          caminhos absolutos do projeto, seu usuário ou sua máquina. O índice e os eventos
          acima ficam somente no dispositivo e nunca são enviados.
        </p>

        <h2>A prévia agregada — ainda local</h2>
        <p>
          Esta versão não tem uploader público nem inscrição de chave. O comando{" "}
          <span className="mono">batuta summary</span> só imprime uma prévia local, e o{" "}
          <span className="mono">batuta report</span> continua funcionando inteiro offline.
        </p>
        <p>
          O contrato planejado é um <strong>resumo diário agregado por skill</strong>,
          nunca o evento cru. Resultado e sucesso ficam zerados: somente recibos do
          runner e atestação separada do juiz podem alimentar essas métricas.
        </p>
        <pre>
          <code>{`{
  "schema": "batuta.daily_summary.v2",
  "date": "2026-08-24",
  "installation_id": "9f2c1ab4de77e015",
  "batuta_version": "0.1.0",
  "mode": "local",
  "routes": 12,
  "routes_with_suggestions": 9,
  "holdout_routes": 1,
  "treatment_arm": { "passed": 0, "total": 0 },
  "holdout_arm": { "passed": 0, "total": 0 },
  "declared_bias": "local observations are not judged outcomes",
  "measurement_disclaimer": "observability only; not proof of delivery",
  "skills": [
    { "skill": "systematic-debugging", "version": "1", "routes": 12,
      "activations": 9, "user_activations": 0, "judged_turns": 0,
      "successful_turns": 0, "reprompts": 0, "errors": 0, "retries": 0,
      "tokens_in": 0, "tokens_out": 0, "cost_usd": 0,
      "median_turns_to_finish": 0, "ghost": false }
  ]
}`}</code>
        </pre>
        <p>
          Sem prompt. Sem hash de prompt. Sem identificador de turno. Sem caminho de
          arquivo. O <span className="mono">installation_id</span> é derivado do próprio sal,
          então não carrega seu nome, sua máquina nem sua pasta — serve só para dizer
          &ldquo;estas linhas vieram do mesmo lugar&rdquo;.
        </p>

        <h2>Confira antes de decidir</h2>
        <pre>
          <code>{`batuta privacy  # o que está guardado
batuta summary  # prévia agregada local; não envia nada`}</code>
        </pre>

        <h2>Endpoint remoto controlado</h2>
        <p>
          A API diária existe para importações de laboratório previamente provisionadas:
          ela exige assinatura e vínculo exato entre chave e instalação. Não há coleta
          pública em produção nesta versão. Se um operador importar uma agregação, ela é
          armazenada no Neon; apagar <span className="mono">~/.batuta</span> não apaga essa
          cópia remota. A coleta pública deve continuar desativada até existir política de
          retenção e exclusão autenticada.
        </p>

        <h2>Apagar tudo</h2>
        <pre>
          <code>rm -rf ~/.batuta</code>
        </pre>
        <p className="miudo">
          Isso apaga apenas o estado local, de modo irreversível. Não existe conta ou login
          de usuário nesta versão.
        </p>

        <h2>O holdout, declarado</h2>
        <p>
          Em 5% dos turnos o roteador <strong>se cala de propósito</strong>. Isso não é
          bug: é uma atribuição local declarada. Sozinha ela não prova causalidade; o
          contrato atual ainda não assina a atribuição antes da execução. É
          declarado na primeira execução, é configurável e é desligável com{" "}
          <span className="mono">batuta config holdout 0</span>. Experimento escondido
          destrói o projeto — então ele não é escondido.
        </p>
      </div>
    </section>
  );
}

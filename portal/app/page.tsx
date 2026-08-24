import { skillRanking } from "@/lib/db";
import { Mostrador } from "@/components/Mostrador";

export const revalidate = 3600;

export default async function Home() {
  // Static-first: the page is generated and revalidated hourly. No database in the
  // reader's path. If the database doesn't exist yet, `skillRanking` returns an
  // empty list and the page tells the truth instead of making up a number.
  const ranking = await skillRanking({ days: 30, limit: 5 });
  const skillsMedidas = ranking.length;

  return (
    <>
      <section className="faixa chamada">
        <div className="centro">
          <div className="chamada-grade">
            <div>
              <p className="olho">medição aberta de agent skills</p>
              <h1>
                Todo mundo tem opinião sobre skills.
                <br />
                Ninguém tem o número.
              </h1>
              <p className="linha-fina">
                O Batuta mede se uma skill funciona de verdade, a que custo e em qual
                modelo. Observações locais ficam locais; releases curadas entram numa
                cadeia verificável, sem lucro.
              </p>
              <div className="botoes">
                <a className="botao botao-forte" href="/instalar">
                  Ver instalação verificada
                </a>
                <a className="botao" href="/manifesto">
                  Ler o manifesto
                </a>
              </div>
            </div>

            <Mostrador />
          </div>
        </div>
      </section>

      <section className="faixa">
        <div className="centro">
          <div className="placar">
            <div>
              <b className={skillsMedidas ? "" : "vazio"}>{skillsMedidas || "0"}</b>
              <span>skills com número publicado</span>
            </div>
            <div>
              <b className="vazio">0</b>
              <span>receitas publicadas</span>
            </div>
            <div>
              <b>24</b>
              <span>tarefas na bateria congelada</span>
            </div>
            <div>
              <b>&lt;50ms</b>
              <span>orçamento operacional por rota no corpus congelado</span>
            </div>
          </div>

          <div className="aviso">
            <p>
              <strong>Os dois primeiros números são zero, e isso está certo.</strong> A
              Fase 1 é provar o método na trilha de código, onde o juiz é quase grátis
              (o teste passa ou não passa). Nada é publicado aqui antes de ter sido
              medido — e quando for, vem com o dado cru junto.
            </p>
          </div>

          <h2>O que o Batuta é</h2>
          <p>
            Existem hoje dezenas de roteadores de skill. <strong>Nenhum deles publica
            dado.</strong> Cada um mede o próprio gol com a própria régua, e por isso
            nenhum consegue provar que é melhor que o vizinho — nem que serve para
            alguma coisa.
          </p>
          <p>
            O Batuta não entra nessa fila. Ele entra como <strong>juiz</strong>: a
            camada de medição funciona com qualquer roteador. O nosso roteador é
            implementação de referência, não o produto.
          </p>

          <h3>como funciona, em três peças</h3>

          <div className="cartao cartao-num" data-num="1">
            <h4>Um binário que não atrapalha</h4>
            <p>
              Um hook local roda antes do seu turno, olha as skills que você já tem e
              sugere no máximo três. BM25, sem rede e sem LLM — o benchmark reproduzível
              exige menos de 50 ms no caminho operacional do corpus congelado. Se nada casar claramente, ele fica
              calado: falso positivo custa mais que falso negativo.
            </p>
          </div>

          <div className="cartao cartao-num" data-num="2">
            <h4>Um funil que vira número</h4>
            <p>
              <span className="mono">route</span> (o Batuta propôs) →{" "}
              <span className="mono">activate</span> (a skill disparou mesmo) →{" "}
              <span className="mono">outcome</span> (o turno terminou bem?). Daí saem a
              taxa de disparo e as skills fantasma. Em execuções LAB com recibo do runner
              e juiz independente, também saem{" "}
              <strong>custo por tarefa julgada</strong> — porque uma skill pode
              encarecer a chamada e baratear a tarefa, matando reprompt.
            </p>
          </div>

          <div className="cartao cartao-num" data-num="3">
            <h4>Um juiz que não pode se enganar sozinho</h4>
            <p>
              O juiz é <strong>cego</strong> (não sabe se a skill disparou),{" "}
              <strong>não é réu</strong> (modelo nunca julga a própria saída) e é{" "}
              <strong>versionado</strong>. O roteador também declara quando se cala de
              propósito. Nesta versão a comparação entre braços é observacional: uma
              afirmação causal ainda exige atribuição assinada antes da execução.
            </p>
          </div>

          <h2>O que você ganha hoje, sozinho</h2>
          <p>
            Mesmo sem enviar nada, o Batuta te diz quais das suas skills nunca
            dispararam e quais competem entre si pelo mesmo turno.{" "}
            <strong>O relatório funciona 100% offline.</strong> O resumo diário desta
            versão é só uma prévia local; não existe uploader público nem inscrição de
            chave. Custos e resultados confiáveis entram apenas por eventos LAB assinados,
            nunca pelo texto do seu prompt.
          </p>
          <p>
            <a href="/privacidade">Estado local e API controlada, em detalhe →</a>
          </p>

          <h2>Para onde isso vai</h2>
          <p>
            A estrela-polar é infraestrutura pública gratuita: que qualquer pessoa, ONG
            ou governo use IA barata com resultado provado. Mas a ordem importa —{" "}
            <em>se não funcionar nada no ponto um, os outros não têm sentido.</em>{" "}
            Primeiro o número. Depois a receita. Depois a missão.
          </p>
          <div className="botoes">
            <a className="botao" href="/manifesto">
              O manifesto inteiro
            </a>
            <a className="botao" href="/arena">
              Mandar uma tarefa para a fila
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

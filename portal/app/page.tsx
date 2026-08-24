import { rankingSkills } from "@/lib/db";

export const revalidate = 3600;

export default async function Home() {
  // Estatico-primeiro: a pagina e gerada e revalidada de hora em hora. Sem banco no
  // caminho de quem le. Se o banco nao existir ainda, `rankingSkills` devolve lista
  // vazia e a pagina diz a verdade em vez de inventar numero.
  const ranking = await rankingSkills({ dias: 30, limite: 5 });
  const skillsMedidas = ranking.length;

  return (
    <>
      <section className="faixa chamada">
        <div className="centro">
          <p className="olho">camada aberta de medição de agent skills</p>
          <h1>
            Todo mundo tem opinião sobre skills.
            <br />
            Ninguém tem o número.
          </h1>
          <p className="linha-fina">
            O Batuta mede se uma skill funciona de verdade, a que custo e em qual
            modelo — e publica tudo, imutável, sem lucro.
          </p>
          <div className="botoes">
            <a className="botao botao-forte" href="/instalar">
              Instalar em 30 segundos
            </a>
            <a className="botao" href="/manifesto">
              Ler o manifesto
            </a>
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
              <b>2,7ms</b>
              <span>por rota, com 506 skills</span>
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

          <div className="cartao">
            <h4>1. Um binário que não atrapalha</h4>
            <p>
              Um hook local roda antes do seu turno, olha as skills que você já tem e
              sugere no máximo três. BM25, sem rede, sem LLM, sem espera — 2,7 milésimos
              de segundo com 506 skills instaladas. Se nada casar claramente, ele fica
              calado: falso positivo custa mais que falso negativo.
            </p>
          </div>

          <div className="cartao">
            <h4>2. Um funil que vira número</h4>
            <p>
              <span className="mono">route</span> (o Batuta propôs) →{" "}
              <span className="mono">activate</span> (a skill disparou mesmo) →{" "}
              <span className="mono">outcome</span> (o turno terminou bem?). Daí saem a
              taxa de disparo, as skills fantasma, e a métrica que ninguém tem:{" "}
              <strong>custo por tarefa concluída</strong> — porque uma skill pode
              encarecer a chamada e baratear a tarefa, matando reprompt.
            </p>
          </div>

          <div className="cartao">
            <h4>3. Um juiz que não pode se enganar sozinho</h4>
            <p>
              O juiz é <strong>cego</strong> (não sabe se a skill disparou),{" "}
              <strong>não é réu</strong> (modelo nunca julga a própria saída) e é{" "}
              <strong>versionado</strong>. E em 5% dos turnos o roteador se cala de
              propósito, para existir grupo de controle — sem isso a gente mediria
              correlação e chamaria de causa.
            </p>
          </div>

          <h2>O que você ganha hoje, sozinho</h2>
          <p>
            Mesmo sem enviar nada, o Batuta te diz quais das suas skills nunca
            dispararam, quais competem entre si pelo mesmo turno, e quanto cada uma
            está custando por tarefa que terminou bem.{" "}
            <strong>O relatório funciona 100% offline.</strong> Enviar dado é opt-in
            explícito, e o que sobe é resumo diário agregado por skill — nunca evento
            cru, nunca o texto do seu prompt.
          </p>
          <p>
            <a href="/privacidade">O que sobe e o que não sobe, em detalhe →</a>
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

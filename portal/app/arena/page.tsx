import { FormularioArena } from "@/components/FormularioArena";
import { arenaTasks } from "@/lib/db";

export const revalidate = 600;
export const metadata = {
  title: "Arena",
  description:
    "Envie a tarefa real que você quer ver medida. Envio → triagem → canonização → voto → teste → publicação.",
};

const ROTULO: Record<string, string> = {
  screening: "em triagem",
  canonized: "canonizada",
  queued: "na fila",
  running: "rodando",
  published: "publicada",
  rejected: "recusada",
  duplicate: "duplicada",
};

export default async function Arena() {
  const tarefas = await arenaTasks({ limit: 40 });

  return (
    <section className="faixa" style={{ paddingTop: "3rem" }}>
      <div className="centro">
        <p className="olho">envio → triagem → canonização → voto → teste → publicação</p>
        <h1>Arena</h1>
        <p className="linha-fina">
          Você diz qual tarefa real quer ver medida. A gente reescreve, testa e publica
          o resultado com o dado cru junto.
        </p>

        <div className="aviso">
          <p>
            <strong>Sua tarefa nunca roda como chegou.</strong> Ela é reescrita num
            formato fixo — enunciado, critério de aceite e categoria — antes de entrar na
            fila. Não é desconfiança de você: é que autor de skill manda a tarefa que a
            skill dele vence. Quem envia sugere o problema;{" "}
            <strong>a régua é nossa</strong>.
          </p>
          <p>
            E o voto decide <strong>a fila</strong>, nunca o resultado. Popularidade não
            vira nota aqui.
          </p>
        </div>

        <FormularioArena />

        <h2>A fila</h2>
        {tarefas.length === 0 ? (
          <div className="vazio-de-verdade">
            <strong>A fila ainda está vazia.</strong>
            A arena abre de verdade na Fase 2, junto com os primeiros resultados
            publicados. Pode mandar sua tarefa agora — ela fica guardada na triagem.
          </div>
        ) : (
          <div className="rolagem">
            <table>
              <thead>
                <tr>
                  <th>tarefa</th>
                  <th>categoria</th>
                  <th>situação</th>
                  <th>votos</th>
                </tr>
              </thead>
              <tbody>
                {tarefas.map((t) => (
                  <tr key={t.id}>
                    <td>{t.canonical_statement ?? t.original_statement}</td>
                    <td className="mono">{t.category ?? "—"}</td>
                    <td>
                      <span className="etiqueta">{ROTULO[t.status] ?? t.status}</span>
                    </td>
                    <td>{t.votes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3>o que a triagem recusa</h3>
        <ul className="miudo">
          <li>tarefa duplicada de outra que já está na fila</li>
          <li>qualquer coisa com executável escondido, link de download ou comando de shell</li>
          <li>tarefa que depende de conta em serviço externo, ou de dado privado seu</li>
          <li>tarefa cujo critério de aceite ninguém consegue escrever antes de rodar</li>
        </ul>
        <p className="miudo">
          Quando a gente recusa alguma coisa, o motivo se escreve. Está no manifesto.
        </p>
      </div>
    </section>
  );
}

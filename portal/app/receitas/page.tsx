import { receitasPublicadas } from "@/lib/db";

export const revalidate = 3600;
export const metadata = {
  title: "Receitas",
  description:
    "Nome, persona e 6 a 10 skills fixadas em versão, com o bloco de evidência colado. Só entra o que o teste aprovou.",
};

export default async function Receitas() {
  const receitas = await receitasPublicadas();

  return (
    <section className="faixa" style={{ paddingTop: "3rem" }}>
      <div className="centro">
        <p className="olho">o produto original</p>
        <h1>Receitas</h1>
        <p className="linha-fina">
          Uma receita é um manifesto pequeno e versionado: nome, persona, 6 a 10 skills
          fixadas em versão, e o bloco de evidência colado junto.
        </p>

        <p>
          A manchete que uma receita persegue é esta:{" "}
          <em>
            &ldquo;esta receita de seis skills, medida em N turnos, é o melhor ponto de
            partida se você é X.&rdquo;
          </em>{" "}
          Só entra na receita o que o teste aprovou. Não existe receita por opinião.
        </p>

        {receitas.length === 0 ? (
          <div className="vazio-de-verdade">
            <strong>Nenhuma receita publicada ainda.</strong>
            Publicar receita sem evidência seria a mesma coisa que os outros já fazem —
            e é exatamente o que este projeto existe para não fazer.
            <p style={{ marginTop: "1.2rem", marginBottom: 0 }}>
              As primeiras em mesa: <span className="mono">iniciante</span>,{" "}
              <span className="mono">dev-backend</span>,{" "}
              <span className="mono">dev-frontend</span>,{" "}
              <span className="mono">escrita</span>,{" "}
              <span className="mono">dados</span>.
            </p>
          </div>
        ) : (
          receitas.map((r) => (
            <div className="cartao" key={`${r.slug}-${r.versao}`}>
              <h4>
                <span className="mono">
                  {r.slug} v{r.versao}
                </span>
              </h4>
              {r.persona && <p className="miudo">{r.persona}</p>}
              <pre>
                <code>{JSON.stringify(r.skills, null, 2)}</code>
              </pre>
              {r.evidencia ? (
                <>
                  <span className="etiqueta medido">evidência</span>
                  <pre>
                    <code>{JSON.stringify(r.evidencia, null, 2)}</code>
                  </pre>
                </>
              ) : null}
            </div>
          ))
        )}

        <h3>por que versionada</h3>
        <p>
          Receita é documento, não estado. Ela é citável, comparável e atualizável com
          changelog — a versão antiga continua existindo e continua sendo citável por{" "}
          <span className="mono">(slug, versão)</span>. Quem tomou uma decisão com base
          na <span className="mono">v2</span> tem que conseguir voltar e ver a{" "}
          <span className="mono">v2</span>.
        </p>
      </div>
    </section>
  );
}

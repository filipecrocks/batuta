import { Documento } from "@/components/Documento";
import { documento } from "@/lib/markdown";

export const metadata = {
  title: "SPEC — o contrato",
  description: "O contrato do caminho quente: tokenização, BM25, holdout, privacidade e a bateria de conformidade.",
};

export default function Pagina() {
  return (
    <section className="faixa" style={{ paddingTop: "3rem" }}>
      <div className="centro">
        <Documento fonte={documento("spec.md")} />
      </div>
    </section>
  );
}

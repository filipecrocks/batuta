import { Documento } from "@/components/Documento";
import { documento } from "@/lib/markdown";

export const metadata = {
  title: "Manifesto",
  description: "Por que o Batuta existe, os sete princípios e o que garante que o número não é conversa.",
};

export default function Pagina() {
  return (
    <section className="faixa" style={{ paddingTop: "3rem" }}>
      <div className="centro">
        <Documento fonte={documento("manifesto.md")} />
      </div>
    </section>
  );
}

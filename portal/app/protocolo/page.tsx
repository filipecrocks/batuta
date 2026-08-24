import { Documento } from "@/components/Documento";
import { documento } from "@/lib/markdown";

export const metadata = {
  title: "Protocolo do Batuta Zero",
  description: "Como rodar a comparação com e sem skill sem produzir lixo: ordem sorteada, sessão limpa, julgamento cego.",
};

export default function Pagina() {
  return (
    <section className="faixa" style={{ paddingTop: "3rem" }}>
      <div className="centro">
        <Documento fonte={documento("protocolo.md")} />
      </div>
    </section>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://batuta.space"),
  title: {
    default: "Batuta — a camada aberta de medição de Agent Skills",
    template: "%s · Batuta",
  },
  description:
    "Mede se uma Agent Skill funciona de verdade, a que custo e em qual modelo — e publica tudo, imutável, sem lucro.",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "https://batuta.space",
    siteName: "Batuta",
    title: "Batuta — a camada aberta de medição de Agent Skills",
    description:
      "Não é o 27º roteador do mercado. É o juiz — e funciona com qualquer roteador.",
  },
  robots: { index: true, follow: true },
};

const NAVEGACAO: [string, string][] = [
  ["/manifesto", "Manifesto"],
  ["/ranking", "Ranking"],
  ["/receitas", "Receitas"],
  ["/arena", "Arena"],
  ["/registros", "Registros"],
  ["/instalar", "Instalar"],
];

export default function RaizLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="casca">
          <header className="topo">
            <div className="topo-in">
              <a className="marca" href="/">
                <span>▍</span>Batuta<small>medição aberta</small>
              </a>
              <nav>
                {NAVEGACAO.map(([href, texto]) => (
                  <a key={href} href={href}>
                    {texto}
                  </a>
                ))}
              </nav>
            </div>
          </header>

          <main>{children}</main>

          <footer>
            <div className="centro-largo">
              <nav>
                <a href="/manifesto">Manifesto</a>
                <a href="/privacidade">Privacidade</a>
                <a href="/registros">Registros verificáveis</a>
                <a href="/creditos">Créditos</a>
                <a href="/doar">Doar</a>
                <a
                  href="https://github.com/filipecrocks/batuta"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Código
                </a>
              </nav>
              <p style={{ marginTop: "1.2rem", maxWidth: "40rem" }}>
                O Batuta não vende skill, não vende modelo e não vende SaaS. Ninguém
                ganha dinheiro aqui — nem fundadores, nem colaboradores. O número não
                tem por que mentir.
              </p>
              <div className="selo">
                zero lucro · licença MIT · resultados ancorados por hash
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}

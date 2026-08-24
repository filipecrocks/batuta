import type { Metadata } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import { Marca } from "../components/Marca";
import "./globals.css";

/* The house's three voices, served from our own domain (next/font downloads and hosts them):
   no request goes out to Google at runtime, and there's no font flash on load.
   - serif  for what ASSERTS (headings, the name)
   - sans   for what EXPLAINS (prose)
   - mono   for what MEASURES (number, label, command, hash) */
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--fonte-serif",
});
const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--fonte-sans",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--fonte-mono",
});

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
  icons: {
    icon: [
      { url: "/icone.svg", type: "image/svg+xml" },
    ],
  },
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: "#08090a",
  colorScheme: "dark" as const,
};

const NAVEGACAO: [string, string][] = [
  ["/manifesto", "Manifesto"],
  ["/ranking", "Ranking"],
  ["/receitas", "Receitas"],
  ["/arena", "Arena"],
  ["/registros", "Registros"],
  ["/instalar", "Instalar"],
];

const PE: [string, string][] = [
  ["/manifesto", "Manifesto"],
  ["/privacidade", "Privacidade"],
  ["/registros", "Registros verificáveis"],
  ["/spec", "Spec"],
  ["/creditos", "Créditos"],
  ["/doar", "Doar"],
];

export default function RaizLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${serif.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>
        <div className="casca">
          <header className="topo">
            <div className="topo-in">
              <a className="marca" href="/">
                <Marca tamanho={26} />
                <span className="marca-texto">Batuta</span>
                <span className="marca-nota">medição aberta</span>
              </a>
              <nav aria-label="Seções">
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
              <div className="marca-pe">
                <Marca tamanho={20} tom="chapado" />
                <span>Batuta</span>
              </div>
              <nav aria-label="Rodapé">
                {PE.map(([href, texto]) => (
                  <a key={href} href={href}>
                    {texto}
                  </a>
                ))}
                <a
                  href="https://github.com/filipecrocks/batuta"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Código
                </a>
              </nav>
              <p style={{ marginTop: "1.3rem", maxWidth: "40rem" }}>
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

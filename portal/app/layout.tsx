import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import { SiteChrome } from "../components/SiteChrome";
import "./globals.css";

/* The house's three voices, served from our own domain (next/font downloads and hosts them):
   no request goes out to Google at runtime, and there's no font flash on load.
   - serif  for what ASSERTS (headings, the name)
   - sans   for what EXPLAINS (prose)
   - mono   for what MEASURES (number, label, command, hash) */
const display = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--fonte-display",
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
    "Mede Agent Skills por observações locais e publica releases curadas numa cadeia verificável, sem lucro.",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "https://batuta.space",
    siteName: "Batuta",
    title: "Batuta — a camada aberta de medição de Agent Skills",
    description:
      "Não é o 27º roteador do mercado. É uma camada de observabilidade que funciona com qualquer roteador.",
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

export default function RaizLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}

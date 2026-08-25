"use client";

import { Marca } from "./Marca";
import { Locale, LocaleProvider, useLocale } from "./LocaleProvider";

const TEXT = {
  pt: { nav: [["/manifesto", "Manifesto"], ["/ranking", "Resultados"], ["/instalar", "Instalar"]], open: "medição aberta", footer: "Batuta não vende skills, modelos ou SaaS. É infraestrutura pública, gratuita e sem lucro.", privacy: "Privacidade", records: "Registros", code: "Código", seal: "zero lucro · licença MIT · resultados ancorados por hash" },
  en: { nav: [["/manifesto", "Manifesto"], ["/ranking", "Results"], ["/instalar", "Install"]], open: "open measurement", footer: "Batuta does not sell skills, models or SaaS. It is free, nonprofit public infrastructure.", privacy: "Privacy", records: "Records", code: "Code", seal: "nonprofit · MIT license · hash-anchored results" },
  es: { nav: [["/manifesto", "Manifiesto"], ["/ranking", "Resultados"], ["/instalar", "Instalar"]], open: "medición abierta", footer: "Batuta no vende skills, modelos ni SaaS. Es infraestructura pública, gratuita y sin fines de lucro.", privacy: "Privacidad", records: "Registros", code: "Código", seal: "sin lucro · licencia MIT · resultados anclados por hash" },
} satisfies Record<Locale, { nav: string[][]; open: string; footer: string; privacy: string; records: string; code: string; seal: string }>;

function Chrome({ children }: { children: React.ReactNode }) {
  const { locale, setLocale } = useLocale();
  const c = TEXT[locale];
  return <div className="casca">
    <header className="topo"><div className="topo-in">
      <a className="marca" href="/"><Marca tamanho={26} /><span className="marca-texto">Batuta</span><span className="marca-nota">{c.open}</span></a>
      <nav aria-label={locale === "en" ? "Sections" : locale === "es" ? "Secciones" : "Seções"}>{c.nav.map(([href, label]) => <a key={href} href={href}>{label}</a>)}</nav>
      <div className="language-switch language-switch-header" role="group" aria-label="Choose language / Escolher idioma">
        {(["pt", "en", "es"] as Locale[]).map((item) => <button key={item} onClick={() => setLocale(item)} aria-pressed={locale === item}>{{ pt: "Português", en: "English", es: "Español" }[item]}</button>)}
      </div>
    </div></header>
    <main>{children}</main>
    <footer><div className="centro-largo"><div className="marca-pe"><Marca tamanho={20} tom="chapado" /><span>Batuta</span></div><nav aria-label="Footer"><a href="/privacidade">{c.privacy}</a><a href="/registros">{c.records}</a><a href="https://github.com/filipecrocks/batuta" target="_blank" rel="noopener noreferrer">{c.code}</a></nav><p className="footer-statement">{c.footer}</p><div className="selo">{c.seal}</div></div></footer>
  </div>;
}

export function SiteChrome({ children }: { children: React.ReactNode }) {
  return <LocaleProvider><Chrome>{children}</Chrome></LocaleProvider>;
}

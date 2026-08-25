"use client";

import { Locale, useLocale } from "./LocaleProvider";

const COPY = {
  pt: { aria: "Exemplo ilustrativo do formato do relatório local", label: "EXEMPLO · NÃO É RESULTADO PUBLICADO", routes: "rotas", activation: "disparo", cost: "custo/tarefa", ghost: "fantasma", quiet: "silêncio", caption: "Dados fictícios apenas para mostrar o formato. Resultados reais só aparecem no ranking com fonte e recibo." },
  en: { aria: "Illustrative example of the local report format", label: "EXAMPLE · NOT A PUBLISHED RESULT", routes: "routes", activation: "activation", cost: "cost/task", ghost: "ghost", quiet: "quiet", caption: "Fictional data shown only to explain the format. Real results appear in the ranking with a source and receipt." },
  es: { aria: "Ejemplo ilustrativo del formato del informe local", label: "EJEMPLO · NO ES UN RESULTADO PUBLICADO", routes: "rutas", activation: "activación", cost: "coste/tarea", ghost: "fantasma", quiet: "silencio", caption: "Datos ficticios usados solo para explicar el formato. Los resultados reales aparecen en el ranking con fuente y recibo." },
} satisfies Record<Locale, Record<string, string>>;

export function Mostrador() {
  const { locale } = useLocale();
  const c = COPY[locale];
  return <figure className="leitor" aria-label={c.aria}>
    <div className="leitor-topo"><i /><i /><i /><b>{c.label}</b></div>
    <pre><code><s>$</s> <u>batuta report --days 30</u>{"\n\n"}<q>skill                 {c.routes}  {c.activation}  {c.cost}</q>{"\n"}<q>────────────────────────────────────────────</q>{"\n"}<u>debugging</u>              8      0.75      $0.04{"\n"}<u>testing</u>                6      0.66      $0.03{"\n"}<u>example-skill</u>          5      0.00      <s>{c.ghost}</s>{"\n"}<q>────────────────────────────────────────────</q>{"\n"}{c.quiet}: 38%  ·  holdout: 5%</code></pre>
    <figcaption className="leitor-pe">{c.caption} <a href="/ranking">Ranking →</a></figcaption>
  </figure>;
}

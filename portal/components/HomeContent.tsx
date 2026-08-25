"use client";

import { useState } from "react";
import { Mostrador } from "./Mostrador";

type Locale = "pt" | "en" | "es";
type Copy = {
  label: string; title: string; lead: string; install: string; learn: string;
  proof: string; honest: string; honestBody: string; how: string;
  steps: [string, string][]; today: string; todayBody: string;
  mission: string; missionBody: string; manifest: string;
};

const COPY: Record<Locale, Copy> = {
  pt: {
    label: "medição aberta de agentes de IA", title: "Escolha IA com prova, não com torcida.",
    lead: "O Batuta mede agentes, skills e modelos em tarefas reais. Você vê o que funciona, quanto custa e para quem serve — em dados abertos e verificáveis.",
    install: "Começar pela instalação", learn: "Entender em 3 minutos", proof: "O que já podemos provar",
    honest: "Zero inventado é melhor que número bonito.", honestBody: "A publicação começa apenas quando uma medição passa por teste e deixa recibo. Até lá, mostramos claramente o que está em construção.",
    how: "Como funciona", steps: [["Observe", "O Batuta roda localmente, sem enviar o texto dos seus prompts."], ["Meça", "Cada resultado liga tarefa, modelo, tempo, custo e evidência."], ["Compare", "O mesmo protocolo permite decidir com fatos, não marketing."]],
    today: "Útil desde o primeiro dia", todayBody: "Mesmo sozinho e offline, você descobre quais skills realmente entram em ação, quais nunca disparam e onde existe conflito. Com dados públicos suficientes, também poderá comparar receitas por perfil e orçamento.",
    mission: "IA melhor não pode ser privilégio de quem paga mais.", missionBody: "Batuta é infraestrutura pública, gratuita e sem lucro. Uso profissional de IA compreensível para iniciantes e mensurável para especialistas.", manifest: "Ler o manifesto",
  },
  en: {
    label: "open measurement for AI agents", title: "Choose AI with evidence, not hype.",
    lead: "Batuta measures agents, skills and models on real tasks. See what works, what it costs and who it serves — through open, verifiable data.",
    install: "Start with installation", learn: "Understand it in 3 minutes", proof: "What we can prove today",
    honest: "An honest zero beats a polished fiction.", honestBody: "A result is published only after a measurement passes its test and leaves a receipt. Until then, we clearly label what is still being built.",
    how: "How it works", steps: [["Observe", "Batuta runs locally without sending the text of your prompts."], ["Measure", "Every result connects task, model, time, cost and evidence."], ["Compare", "One protocol lets you decide with facts instead of marketing."]],
    today: "Useful from day one", todayBody: "Even offline and on your own, see which skills activate, which stay silent and where conflicts exist. With enough public data, compare recipes for different profiles and budgets.",
    mission: "Better AI cannot be a privilege for those who pay more.", missionBody: "Batuta is free, nonprofit public infrastructure. Professional AI should be understandable for beginners and measurable for experts.", manifest: "Read the manifesto",
  },
  es: {
    label: "medición abierta de agentes de IA", title: "Elige IA con pruebas, no con propaganda.",
    lead: "Batuta mide agentes, skills y modelos en tareas reales. Ves qué funciona, cuánto cuesta y para quién sirve — con datos abiertos y verificables.",
    install: "Empezar por la instalación", learn: "Entenderlo en 3 minutos", proof: "Lo que ya podemos demostrar",
    honest: "Un cero honesto vale más que una cifra bonita.", honestBody: "Un resultado se publica solo cuando la medición supera la prueba y deja un recibo. Hasta entonces, indicamos claramente lo que sigue en construcción.",
    how: "Cómo funciona", steps: [["Observa", "Batuta funciona localmente sin enviar el texto de tus prompts."], ["Mide", "Cada resultado conecta tarea, modelo, tiempo, coste y evidencia."], ["Compara", "Un mismo protocolo permite decidir con hechos, no marketing."]],
    today: "Útil desde el primer día", todayBody: "Incluso sin conexión y por tu cuenta, descubres qué skills se activan, cuáles nunca aparecen y dónde hay conflictos. Con suficientes datos públicos podrás comparar recetas por perfil y presupuesto.",
    mission: "Una IA mejor no puede ser privilegio de quien paga más.", missionBody: "Batuta es infraestructura pública, gratuita y sin fines de lucro. IA profesional comprensible para principiantes y medible para expertos.", manifest: "Leer el manifiesto",
  },
};

export function HomeContent({ skillsMeasured }: { skillsMeasured: number }) {
  const [locale, setLocale] = useState<Locale>("pt");
  const c = COPY[locale];
  return <div lang={locale === "pt" ? "pt-BR" : locale}>
    <section className="faixa chamada"><div className="centro home-wide">
      <div className="language-switch" role="group" aria-label="Choose language / Escolher idioma">
        {(["pt", "en", "es"] as Locale[]).map((item) => <button key={item} onClick={() => setLocale(item)} aria-pressed={locale === item}>{item.toUpperCase()}</button>)}
      </div>
      <div className="chamada-grade"><div className="hero-copy"><p className="olho">{c.label}</p><h1>{c.title}</h1><p className="linha-fina">{c.lead}</p><div className="botoes"><a className="botao botao-forte" href="/instalar">{c.install}</a><a className="botao" href="#como-funciona">{c.learn}</a></div></div><Mostrador /></div>
    </div></section>
    <section className="faixa home-body"><div className="centro home-wide">
      <p className="section-kicker">{c.proof}</p>
      <div className="placar placar-wide"><div><b className={skillsMeasured ? "" : "vazio"}>{skillsMeasured}</b><span>skills measured</span></div><div><b className="vazio">0</b><span>published recipes</span></div><div><b>24</b><span>frozen benchmark tasks</span></div><div><b>&lt;50ms</b><span>local routing budget</span></div></div>
      <aside className="truth-band"><strong>{c.honest}</strong><p>{c.honestBody}</p></aside>
      <div className="content-split" id="como-funciona"><div><p className="section-kicker">01 — {c.how}</p><h2>{c.how}</h2></div><div className="steps">{c.steps.map(([title, body], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{body}</p></article>)}</div></div>
      <div className="statement-grid"><article><p className="section-kicker">02 — Local first</p><h2>{c.today}</h2><p>{c.todayBody}</p><a href="/privacidade">Privacy by design →</a></article><article className="mission"><p className="section-kicker">03 — Public good</p><h2>{c.mission}</h2><p>{c.missionBody}</p><a className="botao" href="/manifesto">{c.manifest}</a></article></div>
    </div></section>
  </div>;
}

"use client";

import { Mostrador } from "./Mostrador";
import { Locale, useLocale } from "./LocaleProvider";
import { NewsletterForm } from "./NewsletterForm";
type Copy = {
  label: string; title: string; lead: string; install: string; learn: string;
  proof: string; honest: string; honestBody: string; how: string;
  steps: [string, string][]; today: string; todayBody: string;
  mission: string; missionBody: string; manifest: string;
  metrics: [string, string, string, string]; source: string;
  glossaryTitle: string; glossaryIntro: string; glossary: [string, string][];
};

const COPY: Record<Locale, Copy> = {
  pt: {
    label: "medição aberta de agentes de IA", title: "Escolha IA com prova, não com torcida.",
    lead: "O Batuta mede agentes, skills e modelos em tarefas reais. Você vê o que funciona, quanto custa e para quem serve — em dados abertos e verificáveis.",
    install: "Começar pela instalação", learn: "Entender em 3 minutos", proof: "O que já podemos provar",
    honest: "Zero inventado é melhor que número bonito.", honestBody: "A publicação começa apenas quando uma medição passa por teste e deixa recibo. Até lá, mostramos claramente o que está em construção.",
    how: "Como funciona", steps: [["Observe", "O Batuta roda localmente, sem enviar o texto dos seus prompts."], ["Meça", "Cada resultado liga tarefa, modelo, tempo, custo e evidência."], ["Compare", "O mesmo protocolo permite decidir com fatos, não marketing."]],
    today: "Útil desde o primeiro dia", todayBody: "Mesmo sozinho e offline, você descobre quais skills realmente entram em ação, quais nunca disparam e onde existe conflito. Com dados públicos suficientes, também poderá comparar receitas por perfil e orçamento.",
    mission: "IA melhor não pode ser privilégio de quem paga mais.", missionBody: "Batuta é infraestrutura pública, gratuita e sem lucro. Uso profissional de IA compreensível para iniciantes e mensurável para especialistas.", manifest: "Ler o manifesto", metrics: ["skills com resultado publicado", "receitas publicadas", "tarefas na bateria v1", "teto medido no corpus v1"], source: "ver fonte", glossaryTitle: "Começando agora? Três palavras bastam.", glossaryIntro: "Você não precisa conhecer o vocabulário inteiro para usar IA melhor.", glossary: [["Agente", "Uma IA que recebe um objetivo e executa etapas para alcançá-lo."], ["Skill", "Uma instrução especializada que ensina o agente a fazer melhor uma tarefa."], ["Modelo", "O motor de IA. Modelos variam em capacidade, velocidade e preço."]],
  },
  en: {
    label: "open measurement for AI agents", title: "Choose AI with evidence, not hype.",
    lead: "Batuta measures agents, skills and models on real tasks. See what works, what it costs and who it serves — through open, verifiable data.",
    install: "Start with installation", learn: "Understand it in 3 minutes", proof: "What we can prove today",
    honest: "An honest zero beats a polished fiction.", honestBody: "A result is published only after a measurement passes its test and leaves a receipt. Until then, we clearly label what is still being built.",
    how: "How it works", steps: [["Observe", "Batuta runs locally without sending the text of your prompts."], ["Measure", "Every result connects task, model, time, cost and evidence."], ["Compare", "One protocol lets you decide with facts instead of marketing."]],
    today: "Useful from day one", todayBody: "Even offline and on your own, see which skills activate, which stay silent and where conflicts exist. With enough public data, compare recipes for different profiles and budgets.",
    mission: "Better AI cannot be a privilege for those who pay more.", missionBody: "Batuta is free, nonprofit public infrastructure. Professional AI should be understandable for beginners and measurable for experts.", manifest: "Read the manifesto", metrics: ["skills with published results", "published recipes", "tasks in benchmark v1", "measured limit on corpus v1"], source: "view source", glossaryTitle: "New here? Three words are enough.", glossaryIntro: "You do not need to learn the whole vocabulary to use AI better.", glossary: [["Agent", "An AI that receives a goal and carries out steps to achieve it."], ["Skill", "Specialized instructions that teach an agent to perform one task better."], ["Model", "The AI engine. Models differ in capability, speed and price."]],
  },
  es: {
    label: "medición abierta de agentes de IA", title: "Elige IA con pruebas, no con propaganda.",
    lead: "Batuta mide agentes, skills y modelos en tareas reales. Ves qué funciona, cuánto cuesta y para quién sirve — con datos abiertos y verificables.",
    install: "Empezar por la instalación", learn: "Entenderlo en 3 minutos", proof: "Lo que ya podemos demostrar",
    honest: "Un cero honesto vale más que una cifra bonita.", honestBody: "Un resultado se publica solo cuando la medición supera la prueba y deja un recibo. Hasta entonces, indicamos claramente lo que sigue en construcción.",
    how: "Cómo funciona", steps: [["Observa", "Batuta funciona localmente sin enviar el texto de tus prompts."], ["Mide", "Cada resultado conecta tarea, modelo, tiempo, coste y evidencia."], ["Compara", "Un mismo protocolo permite decidir con hechos, no marketing."]],
    today: "Útil desde el primer día", todayBody: "Incluso sin conexión y por tu cuenta, descubres qué skills se activan, cuáles nunca aparecen y dónde hay conflictos. Con suficientes datos públicos podrás comparar recetas por perfil y presupuesto.",
    mission: "Una IA mejor no puede ser privilegio de quien paga más.", missionBody: "Batuta es infraestructura pública, gratuita y sin fines de lucro. IA profesional comprensible para principiantes y medible para expertos.", manifest: "Leer el manifiesto", metrics: ["skills con resultados publicados", "recetas publicadas", "tareas en la batería v1", "límite medido en el corpus v1"], source: "ver fuente", glossaryTitle: "¿Estás empezando? Tres palabras bastan.", glossaryIntro: "No necesitas aprender todo el vocabulario para usar mejor la IA.", glossary: [["Agente", "Una IA que recibe un objetivo y ejecuta pasos para alcanzarlo."], ["Skill", "Instrucciones especializadas que enseñan al agente a realizar mejor una tarea."], ["Modelo", "El motor de IA. Los modelos varían en capacidad, velocidad y precio."]],
  },
};

export function HomeContent({ skillsMeasured }: { skillsMeasured: number }) {
  const { locale } = useLocale();
  const c = COPY[locale];
  return <div>
    <section className="faixa chamada"><div className="centro home-wide">
      <div className="chamada-grade"><div className="hero-copy"><p className="olho">{c.label}</p><h1>{c.title}</h1><p className="linha-fina">{c.lead}</p><div className="botoes"><a className="botao botao-forte" href="/instalar">{c.install}</a><a className="botao" href="#como-funciona">{c.learn}</a></div></div><Mostrador /></div>
    </div></section>
    <section className="faixa home-body"><div className="centro home-wide">
      <p className="section-kicker">{c.proof}</p>
      <div className="placar placar-wide"><div><b className={skillsMeasured ? "" : "vazio"}>{skillsMeasured}</b><span>{c.metrics[0]}</span><a className="metric-source" href="/ranking">{c.source}</a></div><div><b className="vazio">0</b><span>{c.metrics[1]}</span><a className="metric-source" href="/receitas">{c.source}</a></div><div><b>24</b><span>{c.metrics[2]}</span><a className="metric-source" href="https://github.com/filipecrocks/batuta/blob/main/bateria/v1/tarefas.json">{c.source}</a></div><div><b>&lt;50ms</b><span>{c.metrics[3]}</span><a className="metric-source" href="https://github.com/filipecrocks/batuta/blob/main/docs/BENCHMARKS.md">{c.source}</a></div></div>
      <aside className="truth-band"><strong>{c.honest}</strong><p>{c.honestBody}</p></aside>
      <div className="content-split" id="como-funciona"><div><h2>{c.how}</h2></div><div className="steps">{c.steps.map(([title, body], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{body}</p></article>)}</div></div>
      <section className="glossary"><div><p className="section-kicker">Glossary</p><h2>{c.glossaryTitle}</h2><p>{c.glossaryIntro}</p></div><dl>{c.glossary.map(([term, definition]) => <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>)}</dl></section>
      <NewsletterForm />
      <div className="statement-grid"><article><p className="section-kicker">Local first</p><h2>{c.today}</h2><p>{c.todayBody}</p><a href="/privacidade">Privacy by design →</a></article><article className="mission"><p className="section-kicker">Public good</p><h2>{c.mission}</h2><p>{c.missionBody}</p><a className="botao" href="/manifesto">{c.manifest}</a></article></div>
    </div></section>
  </div>;
}

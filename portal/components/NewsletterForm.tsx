"use client";

import { useRef, useState } from "react";
import { prepareNewsletterSubscription, NewsletterSubscription } from "@/lib/newsletter-submission";
import { Locale, useLocale } from "./LocaleProvider";

const COPY = {
  pt: { title: "Receba o que foi medido — sem ruído.", body: "Um resumo curto quando houver resultado, guia novo ou receita comprovada. Sem frequência inventada e com saída em um clique.", email: "Seu e-mail", placeholder: "voce@exemplo.com", consent: "Aceito receber novidades do Batuta e posso cancelar quando quiser.", privacy: "Privacidade", submit: "Quero receber", sending: "Enviando…", success: "Pronto. Confira seu e-mail para confirmar.", error: "Não foi possível registrar agora. Confira o e-mail e tente novamente." },
  en: { title: "Get measured findings — without the noise.", body: "A short dispatch when there is a real result, new guide or proven recipe. No invented schedule and one-click unsubscribe.", email: "Your email", placeholder: "you@example.com", consent: "I agree to receive Batuta updates and can unsubscribe at any time.", privacy: "Privacy", submit: "Keep me informed", sending: "Sending…", success: "Done. Check your inbox to confirm.", error: "We could not register you now. Check the address and try again." },
  es: { title: "Recibe resultados medidos — sin ruido.", body: "Un resumen breve cuando haya un resultado, guía nueva o receta comprobada. Sin frecuencia inventada y con baja en un clic.", email: "Tu correo", placeholder: "tu@ejemplo.com", consent: "Acepto recibir novedades de Batuta y puedo darme de baja cuando quiera.", privacy: "Privacidad", submit: "Quiero recibirlo", sending: "Enviando…", success: "Listo. Revisa tu correo para confirmar.", error: "No pudimos registrarte ahora. Revisa el correo e inténtalo de nuevo." },
} satisfies Record<Locale, Record<string, string>>;

export function NewsletterForm() {
  const { locale } = useLocale();
  const c = COPY[locale];
  const [state, setState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const pending = useRef<NewsletterSubscription | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending") return;
    const form = event.currentTarget;
    setState("sending");
    try {
      const data = new FormData(form);
      const request = prepareNewsletterSubscription(pending.current, String(data.get("email") ?? ""), locale === "pt" ? "pt-BR" : locale);
      pending.current = request;
      const response = await fetch("/api/newsletter/subscriptions", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": request.idempotencyKey }, body: request.body });
      if (!response.ok) throw new Error("subscription failed");
      pending.current = null;
      form.reset();
      setState("success");
    } catch { setState("error"); }
  }

  const message = state === "success" ? c.success : state === "error" ? c.error : "";
  return <section className="newsletter" aria-labelledby="newsletter-title"><div><p className="section-kicker">Newsletter</p><h2 id="newsletter-title">{c.title}</h2><p>{c.body}</p></div><form onSubmit={submit}><label htmlFor="newsletter-email">{c.email}</label><div className="newsletter-entry"><input id="newsletter-email" name="email" type="email" inputMode="email" autoComplete="email" maxLength={254} placeholder={c.placeholder} required /><button className="botao botao-forte" disabled={state === "sending"} type="submit">{state === "sending" ? c.sending : c.submit}</button></div><label className="consent-row"><input name="consent" type="checkbox" required /><span>{c.consent} <a href="/privacidade">{c.privacy}</a></span></label><p className={state === "error" ? "newsletter-status newsletter-error" : "newsletter-status"} role="status" aria-live="polite">{message}</p></form></section>;
}

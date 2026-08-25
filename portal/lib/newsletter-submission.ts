export type NewsletterLocale = "en" | "pt-BR" | "es";
export type NewsletterSubscription = { body: string; idempotencyKey: string };

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{7,159}$/;

export function prepareNewsletterSubscription(
  previous: NewsletterSubscription | null,
  rawEmail: string,
  locale: NewsletterLocale,
  generateId: () => string = () => `newsletter:${globalThis.crypto.randomUUID()}`,
): NewsletterSubscription {
  const email = rawEmail.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("a valid newsletter email is required");
  const body = JSON.stringify({ email, locale, consent: true, source: "site-footer" });
  if (previous?.body === body) return previous;
  const idempotencyKey = generateId();
  if (!KEY.test(idempotencyKey)) throw new Error("the browser did not generate a safe newsletter request ID");
  return { body, idempotencyKey };
}

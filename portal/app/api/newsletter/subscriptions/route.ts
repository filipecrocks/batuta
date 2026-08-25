import { sql } from "../../../../lib/db";
import { readLimitedUtf8Body } from "../../../../lib/ingest";
import { NEWSLETTER_IDEMPOTENCY_KEY, NEWSLETTER_LOCALES, newsletterBindings, newsletterOpaqueToken, newsletterRequestDigest, normalizeNewsletterEmail } from "../../../../lib/newsletter-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status: number, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

export async function POST(request: Request) {
  const started = performance.now();
  const requestId = request.headers.get("idempotency-key") ?? "";
  const bindings = newsletterBindings();
  if (!bindings) return reply({ ok: false, error: { code: "UNAVAILABLE", message: "Newsletter signup is unavailable" } }, 503);
  if (!NEWSLETTER_IDEMPOTENCY_KEY.test(requestId)) return reply({ ok: false, error: { code: "INVALID_REQUEST", message: "A valid Idempotency-Key is required" } }, 400);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return reply({ ok: false, error: { code: "FORBIDDEN", message: "Cross-origin signup is not allowed" } }, 403);
  const bodyResult = await readLimitedUtf8Body(request, 8 * 1024);
  if (!bodyResult.ok) return reply({ ok: false, error: { code: "TOO_LARGE", message: bodyResult.error } }, bodyResult.status);
  const raw = bodyResult.body;
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply({ ok: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON" } }, 400); }
  if (!body || Array.isArray(body) || Object.keys(body).some((key) => !["email", "locale", "source", "consent", "website"].includes(key))) return reply({ ok: false, error: { code: "INVALID_REQUEST", message: "Request fields are invalid" } }, 400);
  if (body.website) return reply({ ok: true, status: "pending_confirmation" }, 202);
  const email = normalizeNewsletterEmail(body.email);
  const locale = typeof body.locale === "string" && NEWSLETTER_LOCALES.includes(body.locale as never) ? body.locale : null;
  const source = typeof body.source === "string" && /^[a-z0-9][a-z0-9._/-]{0,63}$/.test(body.source) ? body.source : null;
  if (!email || !locale || !source || body.consent !== true) return reply({ ok: false, error: { code: "VALIDATION_ERROR", message: "Email, locale, source and explicit consent are required" } }, 422);
  const confirmation = newsletterOpaqueToken();
  const management = newsletterOpaqueToken();
  try {
    const result = await sql<{ subscription_status: string }>`select subscription_status from batuta.request_newsletter_subscription(${requestId}, ${newsletterRequestDigest(raw)}, ${email}, ${bindings.encryptionKey}, ${locale}, ${source}, ${confirmation.hash}, ${confirmation.token}, ${management.hash}, ${management.token}, ${bindings.baseUrl}, 5)`;
    const status = result[0]?.subscription_status;
    if (status === "conflict") return reply({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency key was reused with different data" } }, 409);
    if (status === "rate_limited") return reply({ ok: false, error: { code: "RATE_LIMITED", message: "Try again later" } }, 429, { "retry-after": "3600" });
    if (status !== "pending_confirmation") throw new Error("Unexpected newsletter status");
    console.info(JSON.stringify({ event: "newsletter_signup_queued", requestId, locale, source, durationMs: Math.round(performance.now() - started) }));
    return reply({ ok: true, status: "pending_confirmation", message: "Check your inbox to confirm the subscription" }, 202);
  } catch (error) {
    console.error(JSON.stringify({ event: "newsletter_signup_failed", requestId, errorType: error instanceof Error ? error.name : "unknown" }));
    return reply({ ok: false, error: { code: "UNAVAILABLE", message: "Newsletter signup is unavailable" } }, 503);
  }
}

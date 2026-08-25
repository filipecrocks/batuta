import { createHash, randomBytes } from "node:crypto";

export const NEWSLETTER_LOCALES = ["en", "pt-BR", "es"] as const;
export const NEWSLETTER_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{7,159}$/;

export function normalizeNewsletterEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length >= 3 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function newsletterBindings() {
  const encryptionKey = process.env.BATUTA_NEWSLETTER_ENCRYPTION_KEY;
  const baseUrl = process.env.BATUTA_NEWSLETTER_BASE_URL;
  if (!process.env.DATABASE_URL || !encryptionKey || encryptionKey.length < 32 || !baseUrl) return null;
  try { const url = new URL(baseUrl); return url.protocol === "https:" ? { encryptionKey, baseUrl: url.origin } : null; } catch { return null; }
}

export function newsletterOpaqueToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

export const newsletterRequestDigest = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");

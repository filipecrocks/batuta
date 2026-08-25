import assert from "node:assert/strict";
import test from "node:test";
import { prepareNewsletterSubscription } from "./newsletter-submission.ts";
import { readFileSync } from "node:fs";

test("newsletter uses the pending-confirmation API contract", () => {
  const request = prepareNewsletterSubscription(null, " reader@example.com ", "es", () => "newsletter:test-0001");
  assert.equal(request.idempotencyKey, "newsletter:test-0001");
  assert.deepEqual(JSON.parse(request.body), { email: "reader@example.com", locale: "es", consent: true, source: "site-footer" });
});

test("newsletter retries reuse the key only for the same normalized body", () => {
  const first = prepareNewsletterSubscription(null, "reader@example.com", "pt-BR", () => "newsletter:test-0001");
  const retry = prepareNewsletterSubscription(first, " reader@example.com ", "pt-BR", () => "newsletter:test-0002");
  assert.equal(retry.idempotencyKey, first.idempotencyKey);
});

test("newsletter rejects invalid email before the network boundary", () => {
  assert.throws(() => prepareNewsletterSubscription(null, "not-an-email", "en"), /valid newsletter email/);
});

test("newsletter API fails closed without bindings and rejects unknown database state", () => {
  const source = readFileSync(new URL("../app/api/newsletter/subscriptions/route.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!bindings\).*UNAVAILABLE/);
  assert.match(source, /status !== "pending_confirmation"/);
  assert.match(source, /Unexpected newsletter status/);
});

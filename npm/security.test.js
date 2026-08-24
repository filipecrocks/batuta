"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const install = require("./install.js");
const registry = require("./registry.js");
const pkg = require("./package.json");

test("the repository never advertises the unrelated unscoped npm package", () => {
  assert.equal(pkg.name, "@filipecrocks/batuta");
  assert.equal(pkg.private, true);
  assert.equal(pkg.publishConfig.provenance, true);
});

test("network download helpers reject non-HTTPS URLs before opening a socket", async () => {
  await assert.rejects(install.download("http://example.invalid/release"), /non-HTTPS/);
  await assert.rejects(registry.download("http://example.invalid/registry"), /non-HTTPS/);
});

test("BATUTA_HOME is canonical and BATUTA_CASA remains a compatibility fallback", () => {
  const originalHome = process.env.BATUTA_HOME;
  const originalLegacy = process.env.BATUTA_CASA;
  try {
    process.env.BATUTA_HOME = "/canonical";
    process.env.BATUTA_CASA = "/legacy";
    assert.equal(registry.appDir(), "/canonical");
    delete process.env.BATUTA_HOME;
    assert.equal(registry.appDir(), "/legacy");
  } finally {
    if (originalHome === undefined) delete process.env.BATUTA_HOME;
    else process.env.BATUTA_HOME = originalHome;
    if (originalLegacy === undefined) delete process.env.BATUTA_CASA;
    else process.env.BATUTA_CASA = originalLegacy;
  }
});

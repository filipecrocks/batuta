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

test("registry refuses shared or top-level state directories", () => {
  if (process.platform === "win32") {
    assert.throws(() => registry.validateAppDir("C:\\batuta-state"), /ACLs.*Windows/i);
    return;
  }
  assert.throws(() => registry.validateAppDir("/"), /dedicated/i);
  assert.throws(() => registry.validateAppDir(require("node:os").tmpdir()), /dedicated/i);
});

test("registry refuses a missing state leaf below a symlinked ancestor", () => {
  if (process.platform === "win32") return;
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const container = fs.mkdtempSync(path.join(os.tmpdir(), "batuta-registry-link-"));
  const target = path.join(container, "target");
  fs.mkdirSync(target, { mode: 0o700 });
  const link = path.join(container, "link");
  fs.symlinkSync(target, link, "dir");
  assert.throws(() => registry.validateAppDir(path.join(link, "state")), /ancestors.*symlinks/i);
  assert.equal(fs.existsSync(path.join(target, "state")), false);
});

test("globally installed executable remains traversable and executable", () => {
  if (process.platform === "win32") return;
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "batuta-vendor-mode-"));
  const destination = install.writeBinary(Buffer.from("binary"), "batuta", directory);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o755);
  assert.equal(fs.statSync(destination).mode & 0o777, 0o755);
});

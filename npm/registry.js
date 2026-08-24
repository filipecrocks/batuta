#!/usr/bin/env node
"use strict";

// `batuta registry update`
//
// WHY THIS EXISTS, AND WHY IT LIVES HERE AND NOT IN THE BINARY:
// Batuta's Rust binary DOES NOT ACCESS THE NETWORK. Ever. It's project law — the
// hot path routes and logs locally, in milliseconds, and the prompt never leaves
// the machine. A binary that opens a socket is a binary you need to audit every
// week. So whoever handles the network is the wrapper: this file downloads the
// public skill registry from https://batuta.space/registry.json and writes it to
// ~/.batuta/registry.json, which is just another local file the binary reads like
// any other.
//
// Zero npm dependencies: https and fs, from Node itself.

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const SOURCE = process.env.BATUTA_REGISTRY_URL || process.env.BATUTA_REGISTRO_URL || "https://batuta.space/registry.json";
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10_000;

function appDir() {
  if (process.env.BATUTA_HOME) return process.env.BATUTA_HOME;
  if (process.env.BATUTA_CASA) return process.env.BATUTA_CASA;
  return path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), ".batuta");
}

function help() {
  return (
    "batuta registry — the public skill registry\n\n" +
    "  batuta registry update    downloads " + SOURCE + "\n" +
    "                            and writes it to " + path.join(appDir(), "registry.json") + "\n\n" +
    "This runs in the wrapper, not in the binary: the Batuta binary does not access the network.\n"
  );
}

function download(url, hops) {
  hops = hops === undefined ? 6 : hops;
  return new Promise(function (ok, err) {
    if (hops < 0) return err(new Error("too many redirects: " + url));
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return err(new Error("refusing non-HTTPS URL: " + url));
    const request = https
      .get(parsed, { headers: { "user-agent": "batuta-registry" } }, function (res) {
        const s = res.statusCode;
        if (s >= 300 && s < 400 && res.headers.location) {
          res.resume();
          return ok(download(new URL(res.headers.location, url).toString(), hops - 1));
        }
        if (s !== 200) {
          res.resume();
          return err(new Error("HTTP " + s + " at " + url));
        }
        const declared = Number(res.headers["content-length"] || "0");
        if (declared > MAX_DOWNLOAD_BYTES) {
          res.destroy(new Error("registry exceeds 5 MiB"));
          return;
        }
        let received = 0;
        const chunks = [];
        res.on("data", function (d) {
          received += d.length;
          if (received > MAX_DOWNLOAD_BYTES) {
            res.destroy(new Error("registry exceeds 5 MiB"));
            return;
          }
          chunks.push(d);
        });
        res.on("end", function () { ok(Buffer.concat(chunks)); });
        res.on("error", err);
      });
    request.setTimeout(DOWNLOAD_TIMEOUT_MS, function () {
      request.destroy(new Error("registry download timed out"));
    });
    request.on("error", err);
  });
}

async function update() {
  const destination = path.join(appDir(), "registry.json");
  process.stdout.write("  downloading " + SOURCE + "\n");

  let body;
  try {
    body = await download(SOURCE);
  } catch (e) {
    process.stderr.write("\n  batuta registry: could not download: " + e.message + "\n\n");
    return 1;
  }

  // Don't overwrite what already works with garbage.
  try {
    JSON.parse(body.toString("utf8"));
  } catch (e) {
    process.stderr.write("\n  batuta registry: what came back is not valid JSON. Nothing written.\n\n");
    return 1;
  }

  let temporary;
  try {
    fs.mkdirSync(appDir(), { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(appDir(), 0o700);
    temporary = destination + ".tmp-" + process.pid + "-" + Date.now();
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, body);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, destination);
    if (process.platform !== "win32") fs.chmodSync(destination, 0o600);
  } catch (e) {
    if (temporary) try { fs.unlinkSync(temporary); } catch {}
    process.stderr.write("\n  batuta registry: could not write " + destination + ": " + e.message + "\n\n");
    return 1;
  }

  process.stdout.write("  written: " + destination + "  (" + body.length + " bytes)\n");
  return 0;
}

function run(args) {
  const sub = args[0];
  if (sub === "update" || sub === "atualizar") {
    if (sub === "atualizar") process.stderr.write("batuta: warning: 'atualizar' is deprecated; use 'update'\n");
    update().then(function (c) { process.exit(c); });
    return;
  }
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    process.stdout.write(help());
    process.exit(sub ? 0 : 2);
  }
  process.stderr.write("batuta registry: unknown '" + sub + "'\n\n" + help());
  process.exit(2);
}

module.exports = { run: run, appDir: appDir, download: download };

if (require.main === module) run(process.argv.slice(2));

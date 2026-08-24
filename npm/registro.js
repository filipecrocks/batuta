#!/usr/bin/env node
"use strict";

// `batuta registro atualizar` (registry update)
//
// WHY THIS EXISTS, AND WHY IT LIVES HERE AND NOT IN THE BINARY:
// Batuta's Rust binary DOES NOT ACCESS THE NETWORK. Ever. It's project law — the
// hot path routes and logs locally, in milliseconds, and the prompt never leaves
// the machine. A binary that opens a socket is a binary you need to audit every
// week. So whoever handles the network is the wrapper: this file downloads the
// public skill registry from https://batuta.space/registro.json and writes it to
// ~/.batuta/registro.json, which is just another local file the binary reads like
// any other.
//
// Zero npm dependencies: https and fs, from Node itself.

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const FONTE = process.env.BATUTA_REGISTRO_URL || "https://batuta.space/registro.json";

function casa() {
  if (process.env.BATUTA_CASA) return process.env.BATUTA_CASA;
  return path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), ".batuta");
}

function ajuda() {
  return (
    "batuta registro — o registro publico de skills\n\n" +
    "  batuta registro atualizar    baixa " + FONTE + "\n" +
    "                               e grava em " + path.join(casa(), "registro.json") + "\n\n" +
    "Isto roda no wrapper, nao no binario: o binario do Batuta nao acessa a rede.\n"
  );
}

function baixar(url, saltos) {
  saltos = saltos === undefined ? 6 : saltos;
  return new Promise(function (ok, erro) {
    if (saltos < 0) return erro(new Error("redirecionou demais: " + url));
    https
      .get(url, { headers: { "user-agent": "batuta-registro" } }, function (res) {
        const s = res.statusCode;
        if (s >= 300 && s < 400 && res.headers.location) {
          res.resume();
          return ok(baixar(new URL(res.headers.location, url).toString(), saltos - 1));
        }
        if (s !== 200) {
          res.resume();
          return erro(new Error("HTTP " + s + " em " + url));
        }
        const pedacos = [];
        res.on("data", function (d) { pedacos.push(d); });
        res.on("end", function () { ok(Buffer.concat(pedacos)); });
        res.on("error", erro);
      })
      .on("error", erro);
  });
}

async function atualizar() {
  const destino = path.join(casa(), "registro.json");
  process.stdout.write("  baixando " + FONTE + "\n");

  let corpo;
  try {
    corpo = await baixar(FONTE);
  } catch (e) {
    process.stderr.write("\n  batuta registro: nao consegui baixar: " + e.message + "\n\n");
    return 1;
  }

  // Don't overwrite what already works with garbage.
  try {
    JSON.parse(corpo.toString("utf8"));
  } catch (e) {
    process.stderr.write("\n  batuta registro: o que voltou nao e JSON valido. Nada gravado.\n\n");
    return 1;
  }

  try {
    fs.mkdirSync(casa(), { recursive: true });
    const tmp = destino + "." + process.pid;
    fs.writeFileSync(tmp, corpo);
    fs.renameSync(tmp, destino);
  } catch (e) {
    process.stderr.write("\n  batuta registro: nao consegui gravar " + destino + ": " + e.message + "\n\n");
    return 1;
  }

  process.stdout.write("  gravado: " + destino + "  (" + corpo.length + " bytes)\n");
  return 0;
}

function rodar(args) {
  const sub = args[0];
  if (sub === "atualizar" || sub === "update") {
    atualizar().then(function (c) { process.exit(c); });
    return;
  }
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    process.stdout.write(ajuda());
    process.exit(sub ? 0 : 2);
  }
  process.stderr.write("batuta registro: nao conheco '" + sub + "'\n\n" + ajuda());
  process.exit(2);
}

module.exports = { rodar: rodar, casa: casa };

if (require.main === module) rodar(process.argv.slice(2));

#!/usr/bin/env node
"use strict";
// Wrapper burro de proposito: a inteligencia toda e do binario.
// Unica excecao: `batuta registro`, que precisa de rede — e rede nao mora no binario.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);

if (argv[0] === "registro") {
  require("../registro.js").rodar(argv.slice(1));
} else {
  const bin = path.join(__dirname, "..", "vendor", process.platform === "win32" ? "batuta.exe" : "batuta");
  if (!fs.existsSync(bin)) {
    process.stderr.write(
      "batuta: o binario nao esta em " + bin + "\n" +
      "  rode:  node " + path.join(__dirname, "..", "instalar.js") + "\n" +
      "  (ou reinstale:  npm install -g batuta)\n"
    );
    process.exit(1);
  }
  const r = spawnSync(bin, argv, { stdio: "inherit" });
  if (r.error) {
    process.stderr.write("batuta: nao consegui executar " + bin + ": " + r.error.message + "\n");
    process.exit(1);
  }
  process.exit(r.status === null ? 1 : r.status);
}

#!/usr/bin/env node
"use strict";
// Deliberately dumb wrapper: all the intelligence lives in the binary.
// Only exception: `batuta registry`, which needs the network — and the network doesn't live in the binary.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);

if (argv[0] === "registry" || argv[0] === "registro") {
  if (argv[0] === "registro") {
    process.stderr.write("batuta: warning: 'registro' is deprecated; use 'registry'\n");
  }
  require("../registry.js").run(argv.slice(1));
} else {
  const bin = path.join(__dirname, "..", "vendor", process.platform === "win32" ? "batuta.exe" : "batuta");
  if (!fs.existsSync(bin)) {
    process.stderr.write(
      "batuta: the binary is missing at " + bin + "\n" +
      "  run:  node " + path.join(__dirname, "..", "install.js") + "\n" +
      "  or install a checksum-verified GitHub release (see docs/INSTALAR.md)\n"
    );
    process.exit(1);
  }
  const r = spawnSync(bin, argv, { stdio: "inherit" });
  if (r.error) {
    process.stderr.write("batuta: could not run " + bin + ": " + r.error.message + "\n");
    process.exit(1);
  }
  process.exit(r.status === null ? 1 : r.status);
}

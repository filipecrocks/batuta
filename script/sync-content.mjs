#!/usr/bin/env node
// Copies the source documents from the root into the portal.
//
// Why it exists: the root's MANIFESTO.md is the canonical source — it's the file
// people read on GitHub and the one Filipe edits. The portal needs the same text,
// but the Vercel build runs with the root pointed at `portal/`, and going up a
// directory in the build is the kind of thing that works on your machine and
// breaks on theirs.
//
// So the copy is explicit, versioned, and redone at prebuild. If it diverges, the
// build warns. Run `node script/sync-content.mjs` after editing the root.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const destination = join(root, "portal", "conteudo");
const publicDirectory = join(root, "portal", "public");

// markdown documents -> portal/conteudo/
const files = [
  ["MANIFESTO.md", "manifesto.md"],
  ["SPEC.md", "spec.md"],
  ["docs/PROTOCOLO.md", "protocolo.md"],
  ["records/README.md", "records.md"],
  ["bateria/v1/README.md", "bateria.md"],
];

mkdirSync(destination, { recursive: true });
let copied = 0;
for (const [from, to] of files) {
  const source = join(root, from);
  if (!existsSync(source)) {
    console.warn(`[sync] ${from} does not exist yet — skipping`);
    continue;
  }
  writeFileSync(join(destination, to), readFileSync(source));
  copied++;
}

// Public wire contracts are copied from their canonical repository sources so
// API discovery links are guaranteed to describe the deployed validators.
const schemas = [
  "daily-summary.schema.json",
  "daily-summary.v2.schema.json",
  "event.schema.json",
  "lab-event.v1.schema.json",
];
mkdirSync(join(publicDirectory, "schema"), { recursive: true });
for (const schema of schemas) {
  writeFileSync(
    join(publicDirectory, "schema", schema),
    readFileSync(join(root, "schema", schema)),
  );
  copied++;
}
// the installer served at batuta.space/install.sh is THE SAME ONE as in the repo,
// not a separately editable copy — that's what separates trust from asking for
// trust in a `curl | sh`
const installer = join(root, "script", "install.sh");
if (existsSync(installer)) {
  mkdirSync(publicDirectory, { recursive: true });
  writeFileSync(join(publicDirectory, "install.sh"), readFileSync(installer));
  copied++;
}

console.log(`[sync] ${copied} file(s) copied into the portal`);

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
// build warns. Run `node script/sincronizar-conteudo.mjs` after editing the root.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, "..");
const destino = join(raiz, "portal", "conteudo");

// markdown documents -> portal/conteudo/
const arquivos = [
  ["MANIFESTO.md", "manifesto.md"],
  ["SPEC.md", "spec.md"],
  ["docs/PROTOCOLO.md", "protocolo.md"],
  ["registros/README.md", "registros.md"],
  ["bateria/v1/README.md", "bateria.md"],
];

mkdirSync(destino, { recursive: true });
let copiados = 0;
for (const [de, para] of arquivos) {
  const origem = join(raiz, de);
  if (!existsSync(origem)) {
    console.warn(`[sincronizar] ${de} nao existe ainda — pulando`);
    continue;
  }
  writeFileSync(join(destino, para), readFileSync(origem));
  copiados++;
}
// the installer served at batuta.space/instalar.sh is THE SAME ONE as in the repo,
// not a separately editable copy — that's what separates trust from asking for
// trust in a `curl | sh`
const instalador = join(raiz, "script", "instalar.sh");
if (existsSync(instalador)) {
  mkdirSync(join(raiz, "portal", "public"), { recursive: true });
  writeFileSync(join(raiz, "portal", "public", "instalar.sh"), readFileSync(instalador));
  copiados++;
}

console.log(`[sincronizar] ${copiados} arquivo(s) copiado(s) para dentro do portal`);

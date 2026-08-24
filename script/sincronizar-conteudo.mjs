#!/usr/bin/env node
// Copia os documentos-fonte da raiz para dentro do portal.
//
// Por que existe: o MANIFESTO.md da raiz e a fonte canonica — e o arquivo que a
// pessoa le no GitHub e o que o Filipe edita. O portal precisa do mesmo texto, mas
// o build da Vercel roda com a raiz apontada para `portal/`, e subir de diretorio no
// build e o tipo de coisa que funciona na sua maquina e quebra na deles.
//
// Entao a copia e explicita, versionada, e refeita no prebuild. Divergiu, o build
// avisa. Rode `node script/sincronizar-conteudo.mjs` depois de editar a raiz.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, "..");
const destino = join(raiz, "portal", "conteudo");

// documentos markdown -> portal/conteudo/
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
// o instalador servido em batuta.space/instalar.sh e O MESMO do repo, nao uma copia
// editavel a parte — e o que separa confianca de pedido de confianca num `curl | sh`
const instalador = join(raiz, "script", "instalar.sh");
if (existsSync(instalador)) {
  mkdirSync(join(raiz, "portal", "public"), { recursive: true });
  writeFileSync(join(raiz, "portal", "public", "instalar.sh"), readFileSync(instalador));
  copiados++;
}

console.log(`[sincronizar] ${copiados} arquivo(s) copiado(s) para dentro do portal`);

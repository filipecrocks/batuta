#!/usr/bin/env node
"use strict";

// Baixa o binario do Batuta da release que corresponde a "version" do package.json,
// CONFERE o SHA256 contra o SHA256SUMS da mesma release e grava em npm/vendor/.
//
// Zero dependencia npm, por lei do projeto: https, zlib, crypto e fs sao do Node.
// O tar.gz e o zip sao abertos aqui mesmo (30 linhas de cada) para nao depender de
// `tar` do sistema nem de pacote de terceiro.
//
// Se qualquer passo falhar, este script sai com codigo 1 e diz o que fazer.
// Meia instalacao nao existe.

const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const crypto = require("crypto");

const pkg = require("./package.json");

const REPO = "filipecrocks/batuta";
const TAG = process.env.BATUTA_VERSAO || "v" + pkg.version;
const BASE = "https://github.com/" + REPO + "/releases/download/" + TAG;

const ALVOS = {
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
};

function morrer(msg) {
  process.stderr.write("\n  batuta: " + msg + "\n\n");
  process.exit(1);
}

// --------------------------------------------------------------------- download

function baixar(url, saltos) {
  saltos = saltos === undefined ? 6 : saltos;
  return new Promise(function (ok, erro) {
    if (saltos < 0) return erro(new Error("redirecionou demais: " + url));
    https
      .get(url, { headers: { "user-agent": "batuta-npm/" + pkg.version } }, function (res) {
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

// ------------------------------------------------------------------ tar.gz e zip

// Le um tar (ustar) ja descomprimido e devolve o conteudo da entrada pedida.
function doTar(buf, alvo) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const cab = buf.slice(off, off + 512);
    if (cab[0] === 0) break; // bloco de fim
    const nome = cab.slice(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefixo = cab.slice(345, 500).toString("utf8").replace(/\0.*$/, "");
    const inteiro = prefixo ? prefixo + "/" + nome : nome;
    const tam = parseInt(cab.slice(124, 136).toString("utf8").replace(/[\0 ]/g, ""), 8) || 0;
    const tipo = String.fromCharCode(cab[156]);
    const dados = off + 512;
    if ((tipo === "0" || tipo === "\0") && path.basename(inteiro) === alvo) {
      return buf.slice(dados, dados + tam);
    }
    off = dados + Math.ceil(tam / 512) * 512;
  }
  return null;
}

function doTarGz(buf, alvo) {
  return doTar(zlib.gunzipSync(buf), alvo);
}

// Le um zip pelo diretorio central e devolve o conteudo da entrada pedida.
function doZip(buf, alvo) {
  let fim = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error("zip sem diretorio central");
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip corrompido");
    const metodo = buf.readUInt16LE(p + 10);
    const comp = buf.readUInt32LE(p + 20);
    const lnome = buf.readUInt16LE(p + 28);
    const lextra = buf.readUInt16LE(p + 30);
    const lcom = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.slice(p + 46, p + 46 + lnome).toString("utf8");
    if (path.basename(nome) === alvo) {
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("zip corrompido");
      const ln = buf.readUInt16LE(local + 26);
      const le = buf.readUInt16LE(local + 28);
      const ini = local + 30 + ln + le;
      const bruto = buf.slice(ini, ini + comp);
      if (metodo === 0) return bruto;
      if (metodo === 8) return zlib.inflateRawSync(bruto);
      throw new Error("zip com compressao " + metodo + ", que eu nao leio");
    }
    p += 46 + lnome + lextra + lcom;
  }
  return null;
}

// -------------------------------------------------------------------- instalacao

async function principal() {
  const chave = process.platform + "-" + process.arch;
  const alvo = ALVOS[chave];
  if (!alvo) {
    morrer(
      "nao existe binario pronto para " + chave + ".\n" +
      "       Plataformas com binario: " + Object.keys(ALVOS).join(", ") + "\n" +
      "       Nesta maquina, compile:  cargo install --path crates/batuta"
    );
  }

  const janela = process.platform === "win32";
  const pacote = "batuta-" + alvo + (janela ? ".zip" : ".tar.gz");
  const binNome = janela ? "batuta.exe" : "batuta";

  process.stdout.write("  batuta " + TAG + " · " + alvo + "\n");

  let arquivo, somas;
  try {
    arquivo = await baixar(BASE + "/" + pacote);
  } catch (e) {
    morrer(
      "nao consegui baixar " + BASE + "/" + pacote + "\n" +
      "       " + e.message + "\n" +
      "       A release " + TAG + " existe e publicou binario para " + alvo + "?"
    );
  }
  try {
    somas = (await baixar(BASE + "/SHA256SUMS")).toString("utf8");
  } catch (e) {
    morrer("a release " + TAG + " nao publicou SHA256SUMS (" + e.message + ").\n" +
           "       Sem soma para conferir eu NAO instalo.");
  }

  let esperado = null;
  somas.split("\n").forEach(function (linha) {
    const m = linha.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m && path.basename(m[2].trim()) === pacote) esperado = m[1].toLowerCase();
  });
  if (!esperado) {
    morrer("o SHA256SUMS da release " + TAG + " nao tem linha para " + pacote + ".\n" +
           "       Nao instalo o que nao consigo conferir.");
  }

  const obtido = crypto.createHash("sha256").update(arquivo).digest("hex");
  if (obtido !== esperado) {
    morrer(
      "SHA256 NAO BATE. Nada foi gravado.\n" +
      "       esperado: " + esperado + "\n" +
      "       obtido:   " + obtido + "\n" +
      "       Download corrompido — ou alguem no meio do caminho."
    );
  }
  process.stdout.write("  sha256 confere: " + obtido + "\n");

  let bin;
  try {
    bin = janela ? doZip(arquivo, binNome) : doTarGz(arquivo, binNome);
  } catch (e) {
    morrer("o pacote baixou e conferiu, mas nao abriu: " + e.message);
  }
  if (!bin || bin.length === 0) {
    morrer("o pacote nao tem '" + binNome + "' dentro. Release montada errada.");
  }

  const pastaVendor = path.join(__dirname, "vendor");
  const destino = path.join(pastaVendor, binNome);
  try {
    fs.mkdirSync(pastaVendor, { recursive: true });
    const tmp = path.join(pastaVendor, "." + binNome + "." + process.pid);
    fs.writeFileSync(tmp, bin, { mode: 0o755 });
    fs.renameSync(tmp, destino);
    fs.chmodSync(destino, 0o755);
  } catch (e) {
    morrer("nao consegui gravar " + destino + ": " + e.message);
  }

  process.stdout.write(
    "  instalado: " + destino + "\n\n" +
    "  Proximos 3 passos, nesta ordem:\n" +
    "    1.  batuta index           varre suas skills e monta o indice local\n" +
    "    2.  batuta install-hooks   instala o hook UserPromptSubmit\n" +
    "    3.  batuta report          funil, skill fantasma, custo por tarefa\n\n" +
    "  Tudo offline. O prompt nunca sai da sua maquina.  https://batuta.space\n"
  );
}

module.exports = { principal: principal, doTarGz: doTarGz, doZip: doZip };

if (require.main === module) {
  principal().catch(function (e) {
    morrer("erro inesperado: " + (e && e.stack ? e.stack : e));
  });
}

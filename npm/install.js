#!/usr/bin/env node
"use strict";

// Downloads the Batuta binary from the release matching "version" in package.json,
// CHECKS the SHA256 against the SHA256SUMS of that same release, and writes it to npm/vendor/.
//
// Zero npm dependencies, by project law: https, zlib, crypto and fs are Node's own.
// The tar.gz and the zip are opened right here (30 lines each) to avoid depending
// on the system's `tar` or on a third-party package.
//
// If any step fails, this script exits with code 1 and says what to do.
// There is no such thing as a half installation.

const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const crypto = require("crypto");

const pkg = require("./package.json");

const REPO = "filipecrocks/batuta";
const TAG = process.env.BATUTA_VERSION || "v" + pkg.version;
const BASE = "https://github.com/" + REPO + "/releases/download/" + TAG;
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

const TARGETS = {
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
};

function die(msg) {
  process.stderr.write("\n  batuta: " + msg + "\n\n");
  process.exit(1);
}

// --------------------------------------------------------------------- download

function download(url, hops) {
  hops = hops === undefined ? 6 : hops;
  return new Promise(function (ok, err) {
    if (hops < 0) return err(new Error("too many redirects: " + url));
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return err(new Error("refusing non-HTTPS URL: " + url));
    const request = https
      .get(parsed, { headers: { "user-agent": "batuta-npm/" + pkg.version } }, function (res) {
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
          res.destroy(new Error("release download exceeds 64 MiB"));
          return;
        }
        let received = 0;
        const chunks = [];
        res.on("data", function (d) {
          received += d.length;
          if (received > MAX_DOWNLOAD_BYTES) {
            res.destroy(new Error("release download exceeds 64 MiB"));
            return;
          }
          chunks.push(d);
        });
        res.on("end", function () { ok(Buffer.concat(chunks)); });
        res.on("error", err);
      });
    request.setTimeout(DOWNLOAD_TIMEOUT_MS, function () {
      request.destroy(new Error("release download timed out"));
    });
    request.on("error", err);
  });
}

// ------------------------------------------------------------------ tar.gz and zip

// Reads an already-decompressed tar (ustar) and returns the content of the requested entry.
function readTar(buf, target) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.slice(off, off + 512);
    if (header[0] === 0) break; // end block
    const name = header.slice(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.slice(345, 500).toString("utf8").replace(/\0.*$/, "");
    const full = prefix ? prefix + "/" + name : name;
    const size = parseInt(header.slice(124, 136).toString("utf8").replace(/[\0 ]/g, ""), 8) || 0;
    const type = String.fromCharCode(header[156]);
    const dataOffset = off + 512;
    if ((type === "0" || type === "\0") && path.basename(full) === target) {
      return buf.slice(dataOffset, dataOffset + size);
    }
    off = dataOffset + Math.ceil(size / 512) * 512;
  }
  return null;
}

function readTarGz(buf, target) {
  return readTar(zlib.gunzipSync(buf, { maxOutputLength: MAX_DOWNLOAD_BYTES }), target);
}

// Reads a zip via its central directory and returns the content of the requested entry.
function readZip(buf, target) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip has no central directory");
  const totalEntries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < totalEntries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    if (path.basename(name) === target) {
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("corrupt zip");
      const ln = buf.readUInt16LE(localOffset + 26);
      const le = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + ln + le;
      const raw = buf.slice(start, start + compSize);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: MAX_DOWNLOAD_BYTES });
      throw new Error("zip with compression " + method + ", which I don't read");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

// -------------------------------------------------------------------- installation

async function main() {
  const key = process.platform + "-" + process.arch;
  const target = TARGETS[key];
  if (!target) {
    die(
      "no prebuilt binary for " + key + ".\n" +
      "       Platforms with a binary: " + Object.keys(TARGETS).join(", ") + "\n" +
      "       On this machine, build it:  cargo install --path crates/batuta"
    );
  }

  const isWindows = process.platform === "win32";
  const pkgFile = "batuta-" + target + (isWindows ? ".zip" : ".tar.gz");
  const binName = isWindows ? "batuta.exe" : "batuta";

  process.stdout.write("  batuta " + TAG + " · " + target + "\n");

  let file, sums;
  try {
    file = await download(BASE + "/" + pkgFile);
  } catch (e) {
    die(
      "could not download " + BASE + "/" + pkgFile + "\n" +
      "       " + e.message + "\n" +
      "       Does release " + TAG + " exist and publish a binary for " + target + "?"
    );
  }
  try {
    sums = (await download(BASE + "/SHA256SUMS")).toString("utf8");
  } catch (e) {
    die("release " + TAG + " did not publish SHA256SUMS (" + e.message + ").\n" +
        "       With no checksum to verify, I do NOT install.");
  }

  let expected = null;
  sums.split("\n").forEach(function (line) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m && path.basename(m[2].trim()) === pkgFile) expected = m[1].toLowerCase();
  });
  if (!expected) {
    die("SHA256SUMS for release " + TAG + " has no line for " + pkgFile + ".\n" +
        "       I don't install what I can't verify.");
  }

  const obtained = crypto.createHash("sha256").update(file).digest("hex");
  if (obtained !== expected) {
    die(
      "SHA256 MISMATCH. Nothing was written.\n" +
      "       expected: " + expected + "\n" +
      "       obtained: " + obtained + "\n" +
      "       Corrupted download — or someone in the middle."
    );
  }
  process.stdout.write("  sha256 verified: " + obtained + "\n");

  let bin;
  try {
    bin = isWindows ? readZip(file, binName) : readTarGz(file, binName);
  } catch (e) {
    die("the package downloaded and verified, but did not open: " + e.message);
  }
  if (!bin || bin.length === 0) {
    die("the package has no '" + binName + "' inside. Release built wrong.");
  }

  const vendorDir = path.join(__dirname, "vendor");
  const destination = path.join(vendorDir, binName);
  const tmp = path.join(vendorDir, "." + binName + "." + process.pid);
  try {
    fs.mkdirSync(vendorDir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(vendorDir, 0o700);
    const descriptor = fs.openSync(tmp, "wx", 0o700);
    try {
      fs.writeFileSync(descriptor, bin);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(tmp, destination);
    fs.chmodSync(destination, 0o700);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    die("could not write " + destination + ": " + e.message);
  }

  process.stdout.write(
    "  installed: " + destination + "\n\n" +
    "  Next 3 steps, in this order:\n" +
    "    1.  batuta index           scans your skills and builds the local index\n" +
    "    2.  batuta install-hooks   installs the UserPromptSubmit hook\n" +
    "    3.  batuta report          funnel, ghost skills, cost per task\n\n" +
    "  All offline. The prompt never leaves your machine.  https://batuta.space\n"
  );
}

module.exports = { main: main, download: download, readTarGz: readTarGz, readZip: readZip };

if (require.main === module) {
  main().catch(function (e) {
    die("unexpected error: " + (e && e.stack ? e.stack : e));
  });
}

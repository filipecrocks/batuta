# Install Batuta

Three paths. Pick one.

## 1. curl (the shortest)

```sh
curl -fsSL https://batuta.space/instalar.sh | sh
```

Pin the version: `BATUTA_VERSAO=v0.1.0 curl -fsSL https://batuta.space/instalar.sh | sh`
Choose the folder: `BATUTA_DESTINO=/opt/bin curl -fsSL ... | sh`

**Lands at:** `/usr/local/bin/batuta` if you have permission, otherwise `$HOME/.local/bin/batuta`.
A single file. The script checks the SHA256 against the release's `SHA256SUMS` — if it doesn't match, it deletes the download and installs nothing.

Linux and macOS, x86_64 and aarch64. On Windows, use npm.

## 2. npm

```sh
npm install -g batuta
```

**Lands at:** the binary at `<npm-prefix>/lib/node_modules/batuta/vendor/batuta` (`.exe` on Windows) and a `batuta` shortcut in npm's bin. `postinstall` downloads from the release matching the package's version and checks the SHA256 — if that fails, the install fails too.

This is the only path that has `batuta registro atualizar`, which downloads the public skills registry. It lives in the JS wrapper because **the Rust binary doesn't touch the network, by project rule**.

## 3. cargo (building on your machine)

```sh
git clone https://github.com/filipecrocks/batuta
cargo install --path batuta/crates/batuta
```

**Lands at:** `$HOME/.cargo/bin/batuta`. No binary download, no SHA to check — you compiled what you read.

## Verify it worked

```sh
batuta version      # batuta 0.1.0
batuta index        # should say how many skills it found
batuta report       # the number, 100% offline
```

If `batuta: command not found`, the folder isn't on your `PATH`:

```sh
export PATH="$HOME/.local/bin:$PATH"   # or $HOME/.cargo/bin
```

## The next 3 steps

```sh
batuta index           # scans your skills and builds the local index
batuta install-hooks   # installs the UserPromptSubmit hook
batuta report          # funnel, ghost skill, cost per task, lift
```

## Uninstall

| How you installed | How you leave |
|---|---|
| curl | `rm $(command -v batuta)` |
| npm | `npm uninstall -g batuta` |
| cargo | `cargo uninstall batuta` |

And the data, which is yours alone and never left here:

```sh
rm -rf ~/.batuta
```

This deletes the index, events, config, and the salt. Before deleting, `batuta privacidade` shows you exactly what's in there.
If you installed the hook, also remove the `UserPromptSubmit` block from your `~/.claude/settings.json`.

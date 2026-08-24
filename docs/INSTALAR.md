# Instalar o Batuta

Três caminhos. Escolha um.

## 1. curl (o mais curto)

```sh
curl -fsSL https://batuta.space/instalar.sh | sh
```

Fixar a versão: `BATUTA_VERSAO=v0.1.0 curl -fsSL https://batuta.space/instalar.sh | sh`
Escolher a pasta: `BATUTA_DESTINO=/opt/bin curl -fsSL ... | sh`

**Deixa onde:** `/usr/local/bin/batuta` se você tiver permissão, senão `$HOME/.local/bin/batuta`.
Um arquivo só. O script confere o SHA256 contra o `SHA256SUMS` da release — se não bater, ele apaga o download e não instala nada.

Linux e macOS, x86_64 e aarch64. No Windows, use o npm.

## 2. npm

```sh
npm install -g batuta
```

**Deixa onde:** o binário em `<prefixo-do-npm>/lib/node_modules/batuta/vendor/batuta` (`.exe` no Windows) e um atalho `batuta` no bin do npm. O `postinstall` baixa da release da mesma versão do pacote e confere o SHA256 — falhou, o install falha junto.

Este é o único caminho que tem `batuta registro atualizar`, que baixa o registro público de skills. Ele mora no wrapper JS porque **o binário Rust não acessa a rede, por lei do projeto**.

## 3. cargo (compilando na sua máquina)

```sh
git clone https://github.com/filipecrocks/batuta
cargo install --path batuta/crates/batuta
```

**Deixa onde:** `$HOME/.cargo/bin/batuta`. Sem download de binário, sem SHA para conferir — você compilou o que leu.

## Conferir que funcionou

```sh
batuta version      # batuta 0.1.0
batuta index        # deve dizer quantas skills achou
batuta report       # o número, 100% offline
```

Se `batuta: command not found`, a pasta não está no `PATH`:

```sh
export PATH="$HOME/.local/bin:$PATH"   # ou $HOME/.cargo/bin
```

## Os 3 próximos passos

```sh
batuta index           # varre suas skills e monta o índice local
batuta install-hooks   # instala o hook UserPromptSubmit
batuta report          # funil, skill fantasma, custo por tarefa, lift
```

## Desinstalar

| Como instalou | Como sai |
|---|---|
| curl | `rm $(command -v batuta)` |
| npm | `npm uninstall -g batuta` |
| cargo | `cargo uninstall batuta` |

E os dados, que são só seus e nunca saíram daqui:

```sh
rm -rf ~/.batuta
```

Isso apaga índice, eventos, config e o sal. Antes de apagar, `batuta privacidade` mostra exatamente o que tem lá dentro.
Se você instalou o hook, tire o bloco `UserPromptSubmit` do seu `~/.claude/settings.json` também.

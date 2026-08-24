#!/bin/sh
# Instalador do Batuta.
#
#   curl -fsSL https://batuta.space/instalar.sh | sh
#
# Fixar uma versao:   BATUTA_VERSAO=v0.1.0 curl -fsSL https://batuta.space/instalar.sh | sh
# Escolher a pasta:   BATUTA_DESTINO=/opt/bin curl -fsSL https://batuta.space/instalar.sh | sh
#
# POSIX sh puro, sem bashismo. Confere o SHA256 contra o SHA256SUMS da release:
# se nao bater, nao instala. Nada de meia instalacao — ou entra inteiro, ou nao entra.

set -eu

REPO="filipecrocks/batuta"
BASE_API="https://api.github.com/repos/$REPO"
BASE_DL="https://github.com/$REPO/releases/download"
TMPDIR_BATUTA=""

morrer() {
    printf '\n  batuta: %s\n\n' "$1" >&2
    exit 1
}

aviso() {
    printf '  aviso: %s\n' "$1" >&2
}

limpar() {
    [ -n "$TMPDIR_BATUTA" ] && [ -d "$TMPDIR_BATUTA" ] && rm -rf "$TMPDIR_BATUTA"
    return 0
}
trap limpar EXIT INT TERM

tem() {
    command -v "$1" >/dev/null 2>&1
}

# ------------------------------------------------------------------ ferramentas

if tem curl; then
    BAIXADOR=curl
elif tem wget; then
    BAIXADOR=wget
else
    morrer "preciso de curl ou wget para baixar. Instale um dos dois e rode de novo."
fi

baixar() {
    # baixar <url> <destino>
    if [ "$BAIXADOR" = curl ]; then
        curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1" || return 1
    else
        wget -q -O "$2" "$1" || return 1
    fi
}

if tem sha256sum; then
    SOMA="sha256sum"
elif tem shasum; then
    SOMA="shasum -a 256"
elif tem openssl; then
    SOMA="openssl-dgst"
else
    morrer "preciso de sha256sum, shasum ou openssl para conferir o download. Sem conferir, nao instalo."
fi

somar() {
    # somar <arquivo> -> imprime so o hash em minusculo
    if [ "$SOMA" = "openssl-dgst" ]; then
        openssl dgst -sha256 "$1" | sed 's/^.*= *//'
    else
        $SOMA "$1" | cut -d' ' -f1
    fi
}

# ------------------------------------------------------------- so e arquitetura

SISTEMA="$(uname -s)"
MAQUINA="$(uname -m)"

case "$SISTEMA" in
    Linux)  SO="unknown-linux-musl" ;;
    Darwin) SO="apple-darwin" ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
        morrer "no Windows use o npm:  npm install -g batuta
       (ou baixe o .zip em https://github.com/$REPO/releases)" ;;
    *)
        morrer "sistema '$SISTEMA' nao tem binario pronto.
       Compile na mao:  cargo install --path crates/batuta" ;;
esac

case "$MAQUINA" in
    x86_64|amd64)          ARQ="x86_64" ;;
    aarch64|arm64|armv8*)  ARQ="aarch64" ;;
    *)
        morrer "arquitetura '$MAQUINA' nao tem binario pronto.
       Compile na mao:  cargo install --path crates/batuta" ;;
esac

ALVO="$ARQ-$SO"
PACOTE="batuta-$ALVO.tar.gz"

# ------------------------------------------------------------------- que versao

VERSAO="${BATUTA_VERSAO:-}"
if [ -z "$VERSAO" ]; then
    printf '  procurando a ultima release...\n'
    TMPDIR_BATUTA="$(mktemp -d 2>/dev/null || mktemp -d -t batuta)" ||
        morrer "nao consegui criar pasta temporaria."
    baixar "$BASE_API/releases/latest" "$TMPDIR_BATUTA/latest.json" ||
        morrer "nao consegui falar com a API do GitHub.
       Sem internet? Rate limit? Fixe a versao:  BATUTA_VERSAO=v0.1.0 sh instalar.sh"
    VERSAO="$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMPDIR_BATUTA/latest.json" | head -n 1)"
    [ -n "$VERSAO" ] ||
        morrer "nao achei o tag_name na resposta do GitHub.
       Fixe a versao na mao:  BATUTA_VERSAO=v0.1.0 sh instalar.sh"
else
    TMPDIR_BATUTA="$(mktemp -d 2>/dev/null || mktemp -d -t batuta)" ||
        morrer "nao consegui criar pasta temporaria."
fi

printf '  batuta %s · %s\n' "$VERSAO" "$ALVO"

# --------------------------------------------------------- baixar e CONFERIR

URL_PACOTE="$BASE_DL/$VERSAO/$PACOTE"
URL_SOMAS="$BASE_DL/$VERSAO/SHA256SUMS"

baixar "$URL_PACOTE" "$TMPDIR_BATUTA/$PACOTE" ||
    morrer "nao consegui baixar $URL_PACOTE
       Essa versao existe e tem binario para $ALVO?"

baixar "$URL_SOMAS" "$TMPDIR_BATUTA/SHA256SUMS" ||
    morrer "a release $VERSAO nao publicou SHA256SUMS.
       Sem soma para conferir eu NAO instalo."

ESPERADO="$(grep "  $PACOTE\$" "$TMPDIR_BATUTA/SHA256SUMS" | cut -d' ' -f1 | head -n 1)"
[ -n "$ESPERADO" ] ||
    morrer "o SHA256SUMS da release $VERSAO nao tem linha para $PACOTE.
       Nao instalo o que nao consigo conferir."

OBTIDO="$(somar "$TMPDIR_BATUTA/$PACOTE")"

if [ "$ESPERADO" != "$OBTIDO" ]; then
    rm -f "$TMPDIR_BATUTA/$PACOTE"
    morrer "SHA256 NAO BATE. Download apagado, nada foi instalado.
       esperado: $ESPERADO
       obtido:   $OBTIDO
       Pode ser download corrompido — ou alguem no meio do caminho."
fi

printf '  sha256 confere: %s\n' "$OBTIDO"

# ------------------------------------------------------------------- desempacotar

tem tar || morrer "preciso do tar para desempacotar."
( cd "$TMPDIR_BATUTA" && tar -xzf "$PACOTE" ) ||
    morrer "o pacote baixou mas nao abriu. Tente de novo."
[ -f "$TMPDIR_BATUTA/batuta" ] ||
    morrer "o pacote abriu mas nao tinha o binario 'batuta' dentro."
chmod 755 "$TMPDIR_BATUTA/batuta"

# ------------------------------------------------------------------- onde instalar

if [ -n "${BATUTA_DESTINO:-}" ]; then
    DESTINO="$BATUTA_DESTINO"
elif [ -w /usr/local/bin ] 2>/dev/null; then
    DESTINO="/usr/local/bin"
else
    DESTINO="$HOME/.local/bin"
fi

mkdir -p "$DESTINO" || morrer "nao consegui criar $DESTINO."
[ -w "$DESTINO" ] || morrer "$DESTINO existe mas nao tenho permissao de escrever.
       Escolha outra:  BATUTA_DESTINO=\$HOME/.local/bin sh instalar.sh"

# mv dentro da mesma arvore quando der; se for cross-device, cai no cp.
mv "$TMPDIR_BATUTA/batuta" "$DESTINO/batuta" 2>/dev/null ||
    cp "$TMPDIR_BATUTA/batuta" "$DESTINO/batuta" ||
    morrer "nao consegui gravar $DESTINO/batuta."
chmod 755 "$DESTINO/batuta"

# --------------------------------------------------------------------- conferir

"$DESTINO/batuta" version >/dev/null 2>&1 ||
    morrer "instalei em $DESTINO/batuta mas ele nao roda aqui.
       Binario errado para esta maquina? Abra uma issue com 'uname -sm'."

INSTALADO="$("$DESTINO/batuta" version 2>/dev/null || echo batuta)"

printf '\n  instalado: %s  (%s)\n' "$DESTINO/batuta" "$INSTALADO"

case ":$PATH:" in
    *":$DESTINO:"*) ;;
    *)
        aviso "$DESTINO nao esta no seu PATH."
        printf '         Adicione ao seu ~/.profile, ~/.bashrc ou ~/.zshrc:\n'
        printf '           export PATH="%s:$PATH"\n' "$DESTINO"
        ;;
esac

# ------------------------------------------------------------- os 3 proximos passos

printf '
  Proximos 3 passos, nesta ordem:

    1.  batuta index           varre suas skills e monta o indice local
    2.  batuta install-hooks   instala o hook UserPromptSubmit
    3.  batuta report          o numero: funil, skill fantasma, custo por tarefa

  Tudo offline. O prompt nunca sai da sua maquina.  https://batuta.space
'

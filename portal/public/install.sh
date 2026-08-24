#!/bin/sh
# Batuta installer.
#
#   curl -fsSL https://batuta.space/install.sh | sh
#
# Pin a version:      BATUTA_VERSION=v0.1.0 curl -fsSL https://batuta.space/install.sh | sh
# Choose the folder:  BATUTA_DEST=/opt/bin curl -fsSL https://batuta.space/install.sh | sh
#
# Pure POSIX sh, no bashisms. Checks the SHA256 against the release's SHA256SUMS:
# if it doesn't match, it doesn't install. No half installation — it goes in whole, or not at all.

set -eu

REPO="filipecrocks/batuta"
BASE_API="https://api.github.com/repos/$REPO"
BASE_DL="https://github.com/$REPO/releases/download"
TMPDIR_BATUTA=""

die() {
    printf '\n  batuta: %s\n\n' "$1" >&2
    exit 1
}

warn() {
    printf '  warning: %s\n' "$1" >&2
}

cleanup() {
    [ -n "$TMPDIR_BATUTA" ] && [ -d "$TMPDIR_BATUTA" ] && rm -rf "$TMPDIR_BATUTA"
    return 0
}
trap cleanup EXIT INT TERM

has() {
    command -v "$1" >/dev/null 2>&1
}

# ------------------------------------------------------------------ tools

if has curl; then
    DOWNLOADER=curl
elif has wget; then
    DOWNLOADER=wget
else
    die "need curl or wget to download. Install one of them and run again."
fi

download() {
    # download <url> <destination>
    if [ "$DOWNLOADER" = curl ]; then
        curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1" || return 1
    else
        wget -q -O "$2" "$1" || return 1
    fi
}

if has sha256sum; then
    SUM="sha256sum"
elif has shasum; then
    SUM="shasum -a 256"
elif has openssl; then
    SUM="openssl-dgst"
else
    die "need sha256sum, shasum or openssl to verify the download. Without verifying, I don't install."
fi

checksum() {
    # checksum <file> -> prints only the hash in lowercase
    if [ "$SUM" = "openssl-dgst" ]; then
        openssl dgst -sha256 "$1" | sed 's/^.*= *//'
    else
        $SUM "$1" | cut -d' ' -f1
    fi
}

# ------------------------------------------------------------- os and architecture

OS_NAME="$(uname -s)"
MACHINE="$(uname -m)"

case "$OS_NAME" in
    Linux)  OS="unknown-linux-musl" ;;
    Darwin) OS="apple-darwin" ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
        die "on Windows use npm:  npm install -g batuta
       (or download the .zip at https://github.com/$REPO/releases)" ;;
    *)
        die "system '$OS_NAME' has no prebuilt binary.
       Build it by hand:  cargo install --path crates/batuta" ;;
esac

case "$MACHINE" in
    x86_64|amd64)          ARCH="x86_64" ;;
    aarch64|arm64|armv8*)  ARCH="aarch64" ;;
    *)
        die "architecture '$MACHINE' has no prebuilt binary.
       Build it by hand:  cargo install --path crates/batuta" ;;
esac

TARGET="$ARCH-$OS"
PACKAGE="batuta-$TARGET.tar.gz"

# ------------------------------------------------------------------- which version

VERSION="${BATUTA_VERSION:-}"
if [ -z "$VERSION" ]; then
    printf '  looking up the latest release...\n'
    TMPDIR_BATUTA="$(mktemp -d 2>/dev/null || mktemp -d -t batuta)" ||
        die "could not create a temp folder."
    download "$BASE_API/releases/latest" "$TMPDIR_BATUTA/latest.json" ||
        die "could not reach the GitHub API.
       No internet? Rate limit? Pin a version:  BATUTA_VERSION=v0.1.0 sh install.sh"
    VERSION="$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMPDIR_BATUTA/latest.json" | head -n 1)"
    [ -n "$VERSION" ] ||
        die "could not find tag_name in the GitHub response.
       Pin the version by hand:  BATUTA_VERSION=v0.1.0 sh install.sh"
else
    TMPDIR_BATUTA="$(mktemp -d 2>/dev/null || mktemp -d -t batuta)" ||
        die "could not create a temp folder."
fi

printf '  batuta %s · %s\n' "$VERSION" "$TARGET"

# --------------------------------------------------------- download and CHECK

PACKAGE_URL="$BASE_DL/$VERSION/$PACKAGE"
SUMS_URL="$BASE_DL/$VERSION/SHA256SUMS"

download "$PACKAGE_URL" "$TMPDIR_BATUTA/$PACKAGE" ||
    die "could not download $PACKAGE_URL
       Does that version exist, and does it have a binary for $TARGET?"

download "$SUMS_URL" "$TMPDIR_BATUTA/SHA256SUMS" ||
    die "release $VERSION did not publish SHA256SUMS.
       With no checksum to verify, I do NOT install."

EXPECTED="$(grep "  $PACKAGE\$" "$TMPDIR_BATUTA/SHA256SUMS" | cut -d' ' -f1 | head -n 1)"
[ -n "$EXPECTED" ] ||
    die "SHA256SUMS for release $VERSION has no line for $PACKAGE.
       I don't install what I can't verify."

OBTAINED="$(checksum "$TMPDIR_BATUTA/$PACKAGE")"

if [ "$EXPECTED" != "$OBTAINED" ]; then
    rm -f "$TMPDIR_BATUTA/$PACKAGE"
    die "SHA256 MISMATCH. Download deleted, nothing was installed.
       expected: $EXPECTED
       obtained: $OBTAINED
       Could be a corrupted download — or someone in the middle."
fi

printf '  sha256 verified: %s\n' "$OBTAINED"

# ------------------------------------------------------------------- unpack

has tar || die "need tar to unpack."
( cd "$TMPDIR_BATUTA" && tar -xzf "$PACKAGE" ) ||
    die "the package downloaded but did not open. Try again."
[ -f "$TMPDIR_BATUTA/batuta" ] ||
    die "the package opened but had no 'batuta' binary inside."
chmod 755 "$TMPDIR_BATUTA/batuta"

# ------------------------------------------------------------------- where to install

if [ -n "${BATUTA_DEST:-}" ]; then
    DEST="$BATUTA_DEST"
elif [ -w /usr/local/bin ] 2>/dev/null; then
    DEST="/usr/local/bin"
else
    DEST="$HOME/.local/bin"
fi

mkdir -p "$DEST" || die "could not create $DEST."
[ -w "$DEST" ] || die "$DEST exists but I don't have write permission.
       Choose another one:  BATUTA_DEST=\$HOME/.local/bin sh install.sh"

# mv within the same tree when possible; falls back to cp if cross-device.
mv "$TMPDIR_BATUTA/batuta" "$DEST/batuta" 2>/dev/null ||
    cp "$TMPDIR_BATUTA/batuta" "$DEST/batuta" ||
    die "could not write $DEST/batuta."
chmod 755 "$DEST/batuta"

# --------------------------------------------------------------------- verify

"$DEST/batuta" version >/dev/null 2>&1 ||
    die "installed at $DEST/batuta but it does not run here.
       Wrong binary for this machine? Open an issue with 'uname -sm'."

INSTALLED="$("$DEST/batuta" version 2>/dev/null || echo batuta)"

printf '\n  installed: %s  (%s)\n' "$DEST/batuta" "$INSTALLED"

case ":$PATH:" in
    *":$DEST:"*) ;;
    *)
        warn "$DEST is not on your PATH."
        printf '         Add this to your ~/.profile, ~/.bashrc or ~/.zshrc:\n'
        printf '           export PATH="%s:$PATH"\n' "$DEST"
        ;;
esac

# ------------------------------------------------------------- the next 3 steps

printf '
  Next 3 steps, in this order:

    1.  batuta index           scans your skills and builds the local index
    2.  batuta install-hooks   installs the UserPromptSubmit hook
    3.  batuta report          the number: funnel, ghost skills, cost per task

  All offline. The prompt never leaves your machine.  https://batuta.space
'

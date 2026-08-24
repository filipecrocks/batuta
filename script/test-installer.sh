#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/batuta-installer-test.XXXXXX")
trap 'rm -rf "$test_root"' EXIT INT TERM
fake_bin="$test_root/bin"
destination="$test_root/destination with spaces"
log="$test_root/downloads.log"
mkdir -p "$fake_bin"

printf '%s\n' \
  '#!/bin/sh' \
  'destination=""' \
  'url=""' \
  'while [ "$#" -gt 0 ]; do' \
  '  case "$1" in' \
  '    -o) destination=$2; shift 2 ;;' \
  '    https://*) url=$1; shift ;;' \
  '    *) shift ;;' \
  '  esac' \
  'done' \
  'printf "%s\n" "$url" >> "$BATUTA_TEST_DOWNLOAD_LOG"' \
  'case "$url" in' \
  '  */SHA256SUMS) printf "verified  batuta-x86_64-unknown-linux-musl.tar.gz\n" > "$destination" ;;' \
  '  *) printf "archive" > "$destination" ;;' \
  'esac' > "$fake_bin/curl"

printf '%s\n' \
  '#!/bin/sh' \
  'printf "verified  %s\n" "$1"' > "$fake_bin/sha256sum"

printf '%s\n' '#!/bin/sh' 'exit 0' > "$fake_bin/gh"

printf '%s\n' \
  '#!/bin/sh' \
  'printf "%s\n" "#!/bin/sh" "printf '\''batuta test\\n'\''" > batuta' \
  'chmod 755 batuta' > "$fake_bin/tar"

chmod 755 "$fake_bin/curl" "$fake_bin/sha256sum" "$fake_bin/gh" "$fake_bin/tar"

PATH="$fake_bin:/usr/bin:/bin" BATUTA_TEST_DOWNLOAD_LOG="$log" \
  sh -c 'cat "$1" | BATUTA_VERSION=v9.9.9 BATUTA_DEST="$2" sh' sh \
  "$repo_root/script/install.sh" "$destination"

grep -q '/releases/download/v9.9.9/batuta-x86_64-unknown-linux-musl.tar.gz$' "$log"
grep -q '/releases/download/v9.9.9/SHA256SUMS$' "$log"
! grep -q '/releases/latest$' "$log"
test -x "$destination/batuta"

printf 'Installer pin and destination propagation passed\n'

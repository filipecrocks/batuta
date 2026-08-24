#!/usr/bin/env sh
# Records a Skill activation only when it belongs to the allowlist emitted by
# the active Batuta route. The binary validates the untrusted hook payload.
set -eu
BATUTA_EXECUTABLE=__BATUTA_EXECUTABLE__
[ -x "$BATUTA_EXECUTABLE" ] || exit 0
if command -v timeout >/dev/null 2>&1; then
  timeout 0.3 "$BATUTA_EXECUTABLE" hook activation --stdin-json 2>/dev/null || exit 0
else
  "$BATUTA_EXECUTABLE" hook activation --stdin-json 2>/dev/null || exit 0
fi

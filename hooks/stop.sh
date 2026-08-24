#!/usr/bin/env sh
# A Stop hook closes the local lifecycle as an UNKNOWN observation. It never
# claims success; passed/failed verdicts require an independent signed judge.
set -eu
BATUTA_EXECUTABLE=__BATUTA_EXECUTABLE__
[ -x "$BATUTA_EXECUTABLE" ] || exit 0
if command -v timeout >/dev/null 2>&1; then
  timeout 0.3 "$BATUTA_EXECUTABLE" hook outcome --stdin-json 2>/dev/null || exit 0
else
  "$BATUTA_EXECUTABLE" hook outcome --stdin-json 2>/dev/null || exit 0
fi

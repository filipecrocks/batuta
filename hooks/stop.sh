#!/usr/bin/env sh
# A Stop hook closes the local lifecycle as an UNKNOWN observation. It never
# claims success; passed/failed verdicts require an independent signed judge.
set -eu
command -v batuta >/dev/null 2>&1 || exit 0
if command -v timeout >/dev/null 2>&1; then
  timeout 0.3 batuta hook outcome --stdin-json 2>/dev/null || exit 0
else
  batuta hook outcome --stdin-json 2>/dev/null || exit 0
fi

#!/usr/bin/env sh
# Records a Skill activation only when it belongs to the allowlist emitted by
# the active Batuta route. The binary validates the untrusted hook payload.
set -eu
command -v batuta >/dev/null 2>&1 || exit 0
if command -v timeout >/dev/null 2>&1; then
  timeout 0.3 batuta hook activation --stdin-json 2>/dev/null || exit 0
else
  batuta hook activation --stdin-json 2>/dev/null || exit 0
fi

#!/usr/bin/env sh
# Batuta — UserPromptSubmit hook.
#
# The hook's contract, and it's strict: this script BLOCKS the user's turn
# while it runs, and if it exceeds the timeout the entire output is discarded.
# That's why there's no network here, no LLM, no waiting. If batuta isn't on
# PATH, the hook exits quietly with 0 — never with an error, never holding up the turn.
#
# stdin carries the agent's JSON (the "prompt" field). stdout goes into the context.

set -eu

BATUTA_EXECUTABLE=__BATUTA_EXECUTABLE__
[ -x "$BATUTA_EXECUTABLE" ] || exit 0

# 300ms is the hard ceiling. If the machine is on its knees, better to stay quiet.
if command -v timeout >/dev/null 2>&1; then
  timeout 0.3 "$BATUTA_EXECUTABLE" route --stdin-json --mode hook 2>/dev/null || exit 0
else
  "$BATUTA_EXECUTABLE" route --stdin-json --mode hook 2>/dev/null || exit 0
fi

exit 0

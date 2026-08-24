#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

commit=$(git rev-parse HEAD)
if git diff --quiet && git diff --cached --quiet; then
  dirty=false
else
  dirty=true
fi

printf 'benchmark=batuta-route-v1\n'
printf 'utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'commit=%s\n' "$commit"
printf 'dirty=%s\n' "$dirty"
printf 'profile=release\n'
printf 'os=%s\n' "$(uname -srv 2>/dev/null || printf unknown)"
printf 'arch=%s\n' "$(uname -m 2>/dev/null || printf unknown)"
if [ -r /proc/cpuinfo ]; then
  cpu=$(sed -n 's/^model name[[:space:]]*:[[:space:]]*//p' /proc/cpuinfo | head -n 1)
  printf 'cpu=%s\n' "${cpu:-unknown}"
fi
rustc --version --verbose
cargo --version --verbose

cd crates/batuta
cargo test --release --locked --test conformidade c15_hot_path_stays_within_budget -- --exact --nocapture --test-threads=1

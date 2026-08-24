# Reproducible benchmarks

Batuta publishes performance budgets, not context-free numbers copied from one
machine. The current contract is:

- the in-process operational route (scoring, lifecycle state, locked event append
  and sync) over the frozen 500+ skill corpus averages less than 50 ms in a release build;
- every hook also has an independent 300 ms wall-clock deadline;
- the route benchmark is in-process and does not include process startup, disk
  discovery, a network request, or model latency.

Run from the repository root:

```sh
./script/benchmark.sh
```

The script prints UTC time, Git commit and dirty state, Rust versions, OS, CPU,
architecture, build profile, and the benchmark's measured line. Keep that whole
output with any reported result. Compare only runs with equivalent metadata.

The conformance test owns the deterministic corpus and assertion. A number is a
benchmark claim only if it came from the committed script and the commit is
identified; historical prose measurements without that evidence are not current
product claims.

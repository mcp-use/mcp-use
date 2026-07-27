# mcp-use v2 beta benchmark snapshot

This directory contains the exact fixtures, accepted results, rejected runs,
and refresh script used for the July 27, 2026 mcp-use v2 beta comparison.

Read the published methodology and interpretation in the
[SDK v2 benchmark report](https://mcpuse-codex-v1-v2-docs-split.mintlify.site/v2/typescript/benchmarks).

## Contents

- `benchmark-harness/harness/`: Node fixtures, MCP Drill workload, load runner,
  cold-launch runner, and locked npm dependencies.
- `benchmark-harness/extended/`: locked rmcp, tmcp, xmcp, and mcp-handler
  fixtures.
- `data/benchmark-load-2026-07-27.jsonl`: three accepted, position-rotated load
  rounds plus their median summary.
- `data/benchmark-launch-2026-07-27.json`: 100 accepted cold launches per
  target after 10 warmups.
- `data/evidence.json`: install, package, build, and capability-scope evidence.
- `data/rejected/`: incomplete infrastructure runs excluded from all published
  results.
- `scripts/refresh-benchmark.sh`: reproducible quick and full workflows.

## Reproduce the snapshot

Requirements: Node.js 24, npm, pnpm, Rust/Cargo, Docker, and Git.

```bash
MCP_USE_VERSION=2.0.0-beta.61 \
MCP_USE_V1=1.34.5 \
./scripts/refresh-benchmark.sh full
```

Use `quick` instead of `full` for a one-round smoke run. A full run executes
three load rounds and records 100 cold launches after 10 warmups.

The script uses MCP Drill source commit
`284244af63efb109959ccf3cecea0000bad3bfe3`. Review refreshed output before
promoting it: interrupted or capacity-limited attempts belong in
`data/rejected/`, not in the accepted result files.

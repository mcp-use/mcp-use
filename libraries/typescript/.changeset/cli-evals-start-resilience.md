---
"@mcp-use/cli": patch
---

`evals run` no longer stops at the first suite that fails to start. Dropped connections, timeouts, 5xx and 429 responses get up to 3 attempts. Before a start whose answer was lost is sent again, the CLI looks for a run it created (with the requested `--profile`) and uses it; this is best effort, so a suite can occasionally start twice. A suite Cloud rejects is skipped, and 401/403 stops further starts. The runs that started are still waited for and reported, and the suites without a run are listed under `notStarted` in the JSON, `--json-file` and the Markdown report, including when no suite started. The command exits 1 when any suite didn't start.

---
"@mcp-use/cli": patch
---

`evals run` no longer stops at the first suite that fails to start. Dropped connections, timeouts, 5xx and 429 responses get up to 3 attempts, and a start whose answer was lost is only sent again when Cloud shows no run it created. A suite Cloud rejects is skipped, and 401/403 stops further starts. The runs that started are still waited for and reported, the suites without a run are listed under `notStarted` in the JSON and in the Markdown report, and the command exits 1.

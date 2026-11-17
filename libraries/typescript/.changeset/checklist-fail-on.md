---
"@mcp-use/cli": minor
---

Add `--fail-on <none|failed|warnings>` to `mcp-use checklist run` so CI jobs can fail when publishing checks fail. Add `--json-file <path>` to write the JSON result to a file while the readable report still prints. While waiting for a run, `checklist run` now retries status checks that fail with a network error, timeout, rate limit or server error, using exponential backoff, instead of exiting while the run continues on Manufact Cloud.

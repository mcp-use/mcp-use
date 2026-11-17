---
"@mcp-use/cli": minor
---

Add `--fail-on <none|failed|warnings>` to `mcp-use checklist run` so CI jobs can fail when publishing checks fail. While waiting for a run, `checklist run` now retries status checks that fail with a network error, timeout, rate limit or server error, using exponential backoff, instead of exiting while the run continues on Manufact Cloud.

---
"@mcp-use/cli": minor
---

Add `--fail-on <none|failed|warnings>` to `mcp-use checklist run` so CI jobs can fail when publishing checks fail. Policy-review findings count as warnings, as on the dashboard. Add `--json-file <path>` to write the JSON result to a file while the readable report still prints. Add `--markdown-file <path>` to `checklist run` and `checklist get` to write a Markdown report laid out like the dashboard. It includes the dashboard's fix prompt in a collapsed "Prompt for AI agents" block. The JSON result now includes the run's `score` and `targetUrl`. The terminal report counts policy concerns the same way as the dashboard. While waiting for a run, `checklist run` now retries status checks that fail with a network error, timeout, rate limit or server error, using exponential backoff, instead of exiting while the run continues on Manufact Cloud.

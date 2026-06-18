---
"@mcp-use/cli": patch
---

`mcp-use deploy` now surfaces the GitHub App installation URL up front when the app isn't connected or lacks repo access, before any prompt. In a non-interactive context (an agent or CI, without `--yes`) it prints the URL and clear next steps and exits cleanly instead of hanging on an unanswerable prompt.

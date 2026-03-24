---
"@mcp-use/cli": patch
---

Add `-y` / `--yes` to `mcp-use deploy` for non-interactive runs

- Skip confirmation prompts (MCP project, uncommitted changes, final deploy, GitHub connect/retry) when the flag is set
- If not logged in and `--yes` is passed, exit with an error instructing users to run `mcp-use login` first (browser login cannot be automated)
- With `--yes`, post-GitHub-setup “Press Enter” is replaced by polling connection status instead of blocking on stdin

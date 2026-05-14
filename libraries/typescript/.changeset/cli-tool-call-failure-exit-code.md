---
"@mcp-use/cli": patch
---

fix(cli): exit non-zero when `client tools call` returns `isError: true`

`mcp-use client tools call <tool>` printed "✗ Tool execution failed"
but still exited 0, so headless agents and shell pipelines couldn't
distinguish a successful tool call from a failed one. The command now
exits 1 when the tool result has `isError: true`, in both default and
`--json` output modes. The result content is still printed first so the
failure detail remains visible.

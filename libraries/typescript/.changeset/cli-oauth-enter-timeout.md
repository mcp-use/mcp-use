---
"@mcp-use/cli": patch
---

Interactive OAuth in `mcp-use client` no longer fails after 10 seconds at the "Press Enter to open your browser" prompt. The prompt now runs outside the HTTP connection timeout, so `--auth-timeout` governs the whole sign-in, and it closes when that sign-in succeeds, times out or is cancelled. `mcp-use client` and `mcp-use screenshot` also hide the client SDK's info logs; set `MCP_USE_LOG_LEVEL` or `DEBUG` to show them.

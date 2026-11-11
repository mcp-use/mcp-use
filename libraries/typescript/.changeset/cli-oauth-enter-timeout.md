---
"@mcp-use/cli": patch
---

Interactive OAuth in `mcp-use client` no longer fails after 10 seconds at the "Press Enter to open your browser" prompt. The prompt now runs outside the HTTP connection timeout, so `--auth-timeout` governs the whole sign-in, and it closes when the connection succeeds or fails.

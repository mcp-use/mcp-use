---
"mcp-use": patch
---

fix(react): isolate useMcp connection lifecycle with per-connect BrowserMCPClient

Fixes environment/URL switch races where a stale disconnect could interfere with the live MCP session after #1528 guard patches.

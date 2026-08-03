---
"mcp-use": minor
---

Restore `ctx.sendNotification(method, params?)` for custom notifications related to the active MCP request. The v1-compatible helper now delegates to the official v2 request notification primitive without reintroducing sessions or cross-request state.

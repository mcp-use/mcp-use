---
"mcp-use": patch
---

Forward the `MANUFACT_CHAT_URL` environment variable to the embedded Inspector. Previously only the standalone `@mcp-use/inspector` CLI read it, so `mcp-use start --with-inspector` (and `mcp-use dev`) served the Inspector without `window.__MANUFACT_CHAT_URL__`, leaving the hosted chat endpoint unconfigured at runtime. Both embedded mounts now pass it through to `mountInspector`, matching the standalone behavior.

---
"@mcp-use/cli": patch
---

Fix widget asset 404s when `MCP_URL` is set at build time. Vite's `base` and the injected `window.__getFile` now resolve to `${MCP_URL}/mcp-use/widgets/{widget}/`, matching the production static route mounted by the `mcp-use` server.

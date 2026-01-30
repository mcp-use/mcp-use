---
"@mcp-use/cli": patch
---

fix(cli): gateway domain and tunnel cleanup on server exit

- Centralize gateway domain as single source of truth (`run.mcp-use.com`) and use `buildGatewayUrl()` for gateway MCP URLs instead of hardcoded `*.mcp-use.run/mcp`
- On server process exit, await tunnel cleanup before exiting CLI; guard with `cleanupInProgress` to avoid double cleanup

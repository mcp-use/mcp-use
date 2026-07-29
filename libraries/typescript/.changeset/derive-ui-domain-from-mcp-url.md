---
"mcp-use": patch
"@mcp-use/cli": patch
---

Derive the default MCP App `ui.domain` from the canonical MCP endpoint composed from `MCP_URL` and the server `basePath`, while preserving an explicitly configured domain. Treat `MCP_ASSETS_URL` as an independent, complete asset prefix rather than appending the MCP `basePath`.

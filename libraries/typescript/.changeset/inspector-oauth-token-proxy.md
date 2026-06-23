---
"mcp-use": patch
---

Use the Inspector OAuth proxy for browser token exchange during direct MCP OAuth callbacks, so servers that do not expose CORS on `/token` can still complete authentication.

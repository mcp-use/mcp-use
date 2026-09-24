---
"@mcp-use/cli": patch
---

`mcp-use dev --tunnel` now starts the tunnel before importing the server and, when `MCP_URL` is unset, uses the tunnel's origin as `MCP_URL` while the entry loads. OAuth servers get the public URL as their canonical resource without a second run with `MCP_URL` set by hand. An explicit `MCP_URL` still wins.

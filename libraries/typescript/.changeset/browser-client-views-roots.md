---
"@mcp-use/client": patch
---

Fix `BrowserMCPClient` dropping `capabilities.views` shorthand resolution, `roots`, and `defaultRequestOptions` in `createConnectorFromConfig`, matching the node path. Browser-built MCP Apps now advertise the `io.modelcontextprotocol/ui` extension instead of raw `{ views: true }`, so upstream servers correctly serve interactive views.
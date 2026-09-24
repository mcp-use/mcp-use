---
"@mcp-use/client": patch
---

`BrowserMCPClient` now expands the `capabilities.views` shorthand into the `io.modelcontextprotocol/ui` extension and forwards `roots` and `defaultRequestOptions` to the connector, matching the Node client.

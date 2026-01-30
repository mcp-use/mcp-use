---
"mcp-use": patch
---

fix(widgets): auto-inject server origin into connectDomains CSP

- The `enrichDefinitionWithServerOrigin` function now automatically adds the server origin to `connectDomains` in addition to `resourceDomains` and `baseUriDomains`
- This allows widgets to make fetch/XHR/WebSocket calls back to the MCP server without explicitly declaring the domain in CSP
- Fixes an oversight where the CHANGELOG mentioned connectDomains injection but it was not implemented

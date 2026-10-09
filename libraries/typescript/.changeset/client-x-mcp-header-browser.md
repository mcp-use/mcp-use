---
"@mcp-use/client": patch
---

Send `Mcp-Param-*` headers for tool parameters annotated with `x-mcp-header` when calling tools from a browser. The SDK only mirrors these parameters outside browsers, so browser clients such as the Inspector sent the value in the request body only and servers requiring the header rejected the call.

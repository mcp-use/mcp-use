---
"@mcp-use/client": patch
---

Fix `roots` and `defaultRequestOptions` being ignored by the browser client. Both are declared on the shared `BaseServerConfig` and forwarded on the Node path, but `BrowserMCPClient` builds its own connector options and dropped them, so browser callers advertised no roots and got the SDK default request options instead of theirs.

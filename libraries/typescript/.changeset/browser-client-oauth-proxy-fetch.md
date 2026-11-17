---
"@mcp-use/client": patch
---

Route OAuth discovery, registration, and token requests through `oauthProxyUrl` for `BrowserMCPClient`. `HttpConnector` now wraps the configured fetch with the OAuth provider's scoped fetch, so every client applies the proxy the same way and MCP transport requests stay on the configured fetch.

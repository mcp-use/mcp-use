---
"mcp-use": patch
---

Fix OAuth discovery for MCP connections tunneled through a gateway/inspector proxy.

When MCP traffic goes through a proxy (`proxyConfig` / `gatewayUrl`), the SDK transport derives `/.well-known/*` discovery URLs from the proxy URL whenever no `resource_metadata` hint is available — the SSE transport's EventSource cannot read `WWW-Authenticate`, and token refresh runs without a 401 response at hand. Discovery then landed on the proxy origin (which serves no OAuth metadata), failed, and the server was misclassified as "does not support OAuth", hiding the Authenticate button.

`BrowserOAuthClientProvider.getProxyFetch()` now re-anchors connection-origin `.well-known` lookups onto the actual MCP server before routing them through the OAuth proxy, reproducing exactly what a direct connection would have requested (including the RFC 8414 §3.1 / RFC 9728 §3.1 path-insertion form). MCP traffic can therefore always stay behind the proxy — required since browser CORS on direct connections cannot be guaranteed (edge errors bypass CORS middleware) — without breaking OAuth discovery.

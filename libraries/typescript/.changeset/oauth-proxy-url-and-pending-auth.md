---
"mcp-use": minor
---

Add `oauthProxyUrl` and stop misclassifying discovered OAuth servers as unsupported.

- `UseMcpOptions.oauthProxyUrl` lets consumers route only OAuth traffic (`.well-known` discovery, DCR, token exchange) through a transparent server-side proxy for browser CORS while keeping MCP traffic direct to the server. It takes precedence over the URL derived from `proxyConfig.proxyAddress`, and because the transparent proxy swaps the `fetch` rather than the metadata URLs, RFC 8414 §3.3 issuer validation still passes. This replaces routing MCP through the proxy purely to reach the OAuth endpoints, which anchored OAuth discovery on the proxy origin and broke auth for gateway-hosted servers.
- `useMcp` no longer drops a server to `failed` with "Server does not support OAuth" when OAuth discovery already succeeded on an earlier pass. If the auth provider has a prepared authorization URL (and `preventAutoAuth` is set), a later discovery failure — e.g. from a token refresh, SSE fallback, or a metadata probe that fell back to the transport origin — surfaces `pending_auth` (keeping the Authenticate button) instead of masking the working OAuth flow.

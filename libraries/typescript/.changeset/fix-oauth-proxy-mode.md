---
"mcp-use": patch
"@mcp-use/inspector": patch
---

Fix OAuth proxy mode to properly forward client credentials to upstream providers. Add `clientId`, `clientSecret`, and `mode` config options to all OAuth provider implementations. In proxy mode, the MCP server now correctly proxies `/authorize`, `/token`, and `/register` endpoints while injecting server-held credentials upstream. Also fixes Inspector OAuth callback routing.

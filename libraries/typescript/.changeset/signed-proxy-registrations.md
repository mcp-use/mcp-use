---
"mcp-use": patch
---

Fix `oauthProxy` Dynamic Client Registration by issuing local public client IDs,
binding authorization redirects to the registered URIs, keeping upstream client
credentials private, and continuing to send only the MCP server callback URI to
the upstream provider.

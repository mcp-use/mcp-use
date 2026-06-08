---
"mcp-use": patch
---

Fix OAuth metadata discovery for authorization servers with path-suffix issuers (RFC 8414). Construct upstream metadata URLs correctly and mount canonical `/.well-known/oauth-authorization-server{issuer-path}` and `/.well-known/openid-configuration{issuer-path}` routes. Closes #1576.

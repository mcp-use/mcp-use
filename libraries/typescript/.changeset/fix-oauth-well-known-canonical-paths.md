---
"mcp-use": patch
---

Fix OAuth metadata discovery for authorization servers with path-suffix issuers (RFC 8414). Construct the upstream OAuth and OpenID metadata URLs correctly and additionally mount the canonical `/.well-known/oauth-authorization-server{issuer-path}` route. Closes #1576.

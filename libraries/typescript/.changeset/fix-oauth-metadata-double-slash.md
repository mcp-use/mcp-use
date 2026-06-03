---
"mcp-use": patch
---

Fix double slash in OAuth metadata proxy URL for DCR-direct providers (e.g. `oauthAuth0Provider`) by normalizing the issuer's trailing slash before appending `/.well-known/oauth-authorization-server`.

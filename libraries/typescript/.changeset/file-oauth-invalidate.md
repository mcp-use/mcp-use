---
"@mcp-use/client": patch
---

fix(client): let `invalidateCredentials()` remove tokens and client info saved by the default Node file store, so a revoked refresh token is not replayed after `invalid_grant`

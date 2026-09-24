---
"@mcp-use/client": patch
---

`getOAuthTokenExpiry` now reads the JWT `exp` claim when the token payload contains the Base64URL characters `-` or `_`. These tokens previously fell back to `expires_in`, so nothing changes for providers that return `expires_in`. The `authTokens.expires_at` docs now say milliseconds, matching the value `useMcp` has always returned.

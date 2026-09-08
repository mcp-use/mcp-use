---
"mcp-use": patch
---

Fix `createJwtVerifier` reporting a malformed `resource` option as an OAuth `invalid_token` error naming the token's resource claim. A configuration mistake at server startup now throws a `TypeError`, matching `oauthCustomProvider` and the other provider URL options.

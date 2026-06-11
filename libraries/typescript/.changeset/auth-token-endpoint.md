---
"mcp-use": minor
---

Expose the resolved OAuth `token_endpoint` on `useMcp().authTokens` (and add `getTokenEndpoint()` to the browser OAuth provider / session store). This lets consumers persist the token endpoint alongside the access/refresh tokens so a backend can proactively refresh the token before it expires. The field is additive and optional — existing usage is unaffected.

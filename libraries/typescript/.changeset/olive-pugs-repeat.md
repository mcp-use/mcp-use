---
"mcp-use": minor
---

Export `createJwtVerifier` and its `JwtVerifierOptions` and `VerifiedPayload` types from `mcp-use/oauth`, so a custom OAuth provider built with `oauthCustomProvider` can reuse the built-in JWT verification instead of reimplementing it.

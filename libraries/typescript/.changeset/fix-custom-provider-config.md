---
"mcp-use": patch
---

Add missing fields to CustomProviderConfig to match documentation: `userInfoEndpoint`, `jwksUrl`, `clientId`, `clientSecret`, `mode`, `scopesSupported`, and `audience`. Add `getClientId()`, `getUserInfoEndpoint()`, and `getAudience()` as optional methods on the `OAuthProvider` interface. Replace unsafe `(provider as any).config?.clientId` cast in routes with type-safe `provider.getClientId?.()`.

---
"mcp-use": patch
---

refactor(auth): extract `OAuthSessionStore` helper from `BrowserOAuthClientProvider`

Pulls token storage, JWT-expiry-driven refresh (with deduplication),
client-info validation, code-verifier handling, key hashing, and generic
authorization-state persistence into a new platform-neutral
`OAuthSessionStore` helper parameterized over a `KVStore`. The browser
provider now holds an `OAuthSessionStore` and delegates the SDK
`OAuthClientProvider` interface methods to it. No behavior change —
this prepares the ground for a future Node/CLI OAuth provider.

---
"mcp-use": patch
---

`createJwtVerifier` now compares a URL in the `aud` claim with the protected resource after the same canonicalization it already applies to the `resource` claim. A token whose `aud` is `https://api.example.com` for a server whose resource is `https://api.example.com/`, or `https://api.example.com/mcp/` for `https://api.example.com/mcp`, is no longer rejected as "Token audience does not include the protected resource". Non-URL audiences are compared exactly, as before.

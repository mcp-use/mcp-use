---
"@mcp-use/client": patch
---

Fix `useMcp().authTokens.expires_at` moving later on every reconnect for opaque (non-JWT) tokens. The expiry was recomputed as now plus `expires_in` each time stored tokens were read, so a token that was 50 minutes into a 1-hour lifetime was reported as valid for another hour. The absolute expiry is now saved alongside the tokens when they are received and reused on later reads. JWT tokens still use their `exp` claim.

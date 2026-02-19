---
"@mcp-use/inspector": patch
---

Fix OAuth token refresh by adding proactive token renewal before expiry and removing static Authorization header that overrode refreshed tokens

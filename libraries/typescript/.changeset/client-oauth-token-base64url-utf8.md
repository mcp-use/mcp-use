---
"@mcp-use/client": patch
---

Fix RFC 7515 Base64URL and UTF-8 claims parsing in `getOAuthTokenExpiry` to prevent silent token expiration drops and unhandled 401 errors during active OAuth sessions.

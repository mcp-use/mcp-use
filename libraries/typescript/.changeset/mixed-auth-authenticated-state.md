---
"@mcp-use/client": patch
---

Fix `discoverAuthorization()` reporting `authenticated: false` after a successful `authenticate()` on a mixed-auth server, including when the RFC 9728 metadata discovery resolved while authentication was in flight.

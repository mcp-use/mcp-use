---
"@mcp-use/client": patch
---

Prevent overlapping Node OAuth authorization flows during loopback startup, cancel in-flight initialization on dispose, and keep getAuthorizationResponse() awaitable while the flow is still initializing.

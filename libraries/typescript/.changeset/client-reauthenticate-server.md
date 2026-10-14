---
"@mcp-use/client": minor
---

Add `reauthenticateServer(id)` to `useMcpClient()`. It disconnects a managed server, clears its stored OAuth credentials, remounts it, and starts a fresh authorization flow once discovery reaches `pending_auth` (or unauthenticated mixed auth). If the server settles without needing interactive OAuth, the request is dropped, so a later reconnect never starts sign-in on its own.

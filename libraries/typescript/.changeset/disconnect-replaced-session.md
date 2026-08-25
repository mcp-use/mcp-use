---
"@mcp-use/client": patch
---

Disconnect the session that `MCPClient.createSession()` replaces. Recreating a session for a server that already had one overwrote the session slot without disconnecting the old connector, so its stdio child process (or HTTP session) stayed alive and was no longer reachable from `closeSession()`/`closeAllSessions()`.

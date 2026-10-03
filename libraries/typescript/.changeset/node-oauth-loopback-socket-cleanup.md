---
"@mcp-use/client": patch
---

fix(client): terminate keep-alive sockets and set Connection: close on OAuth loopback completion

- Set `Connection: close` header on all HTTP responses emitted by `NodeOAuthClientProvider`'s loopback server.
- Track active sockets in `startLoopback` and forcibly close keep-alive / in-flight sockets via `server.closeAllConnections()` and `socket.destroy()` in `stopLoopback`.
- Prevent CLI commands, long-running processes, and test runners from hanging on unclosed loopback TCP sockets.

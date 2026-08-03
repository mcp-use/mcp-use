---
"mcp-use": patch
---

Replace the packaged bore tunnel client with the hosted WebSocket relay used by `mcp-use dev --tunnel` and `mcp-use start --tunnel`.

This removes the native tunnel binary and its runtime dependencies while preserving named tunnel reuse, Inspector access, MCP App props, and Vite HMR through the public tunnel. Relay keepalives and same-reservation reattachment keep tunnel URLs stable across transient disconnects and Worker deployments without consuming the tunnel creation quota.

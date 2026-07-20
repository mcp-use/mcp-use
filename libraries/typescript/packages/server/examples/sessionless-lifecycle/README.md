# Stateless lifecycle

V2 MCP traffic has no server-side session. `MCPServer` replays registrations into a fresh SDK server for each HTTP request, and callbacks receive request-scoped cancellation and client-capability context.

```bash
pnpm dev
```

Call `request-info` to see request-scoped values. For continuity across calls, return an explicit durable handle and require the client to send it back; do not use process memory as session storage.

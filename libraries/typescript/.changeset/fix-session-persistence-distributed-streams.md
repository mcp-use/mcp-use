---
"mcp-use": patch
---

fix(server): session recovery after restart returns 400 and distributed SSE stream routing

- Fixed #1133: session recovery after server deploy/restart no longer returns `400 Bad Request: Server not initialized`. The transport's internal `_initialized` flag is now set during session recovery so reconnecting clients work seamlessly.
- Integrated `StreamManager` into the server's notification and request flow so that standalone SSE messages (notifications, server-to-client requests) are routed through Redis Pub/Sub in distributed/load-balanced deployments.
- Added distributed request/response correlation: server-to-client requests (sampling, elicitation, roots listing) are now correctly routed back to the originating server instance when the client's response POST lands on a different server.
- Made `RedisStreamManager.create()` idempotent to handle SSE reconnects without duplicate Pub/Sub subscriptions.

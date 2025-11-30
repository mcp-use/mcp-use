# MCP Server Notification Example

This example demonstrates how to send **customized notifications to different connected clients** using MCP's stateful session management.

## Key Concepts

### Stateful Sessions Required

**Notifications only work in stateful mode.** This means:

- Clients must connect and maintain an active session (via SSE stream)
- The server tracks sessions in memory using the `mcp-session-id` header
- Notifications are sent through the active transport to the standalone SSE stream
- In stateless mode (edge environments like Cloudflare Workers), notifications are silently discarded

### Notification Methods

The `McpServer` class provides three methods for notifications:

```typescript
// Get list of active session IDs
const sessions = server.getActiveSessions();

// Broadcast to ALL connected clients
await server.sendNotification("custom/event", { data: "hello everyone" });

// Send to a SPECIFIC client by session ID
await server.sendNotificationToSession(sessionId, "custom/event", { data: "hello you" });
```

### JSON-RPC Notification Format

Notifications follow the [MCP specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/index#notifications):

```json
{
  "jsonrpc": "2.0",
  "method": "custom/my-notification",
  "params": {
    "message": "Hello!",
    "timestamp": "2025-01-01T00:00:00.000Z"
  }
}
```

Note: Notifications do NOT include an `id` field (unlike requests).

## Running the Example

### From the mcp-use package directory

```bash
cd libraries/typescript/packages/mcp-use
pnpm run example:server:notification
```

### 3. Connect Clients

1. Open http://localhost:3000/inspector in your browser
2. Click "Connect" to establish a session
3. Open a **second browser tab** and connect another client
4. Wait 5 seconds - each client receives a **customized** "welcome" notification
5. Every 10 seconds, all clients receive a "heartbeat" notification

### 4. Check RPC Logs

In the Inspector, open the **RPC Logs** panel to see incoming notifications:

- `custom/welcome` - Sent once per client with customized data (client number, unique ID)
- `custom/heartbeat` - Broadcast to all clients every 10 seconds
- `custom/broadcast` - Sent when you call the `broadcast-notification` tool

## Example Output

When 2 clients are connected, you'll see:

**Client #1 receives:**
```json
{
  "jsonrpc": "2.0",
  "method": "custom/welcome",
  "params": {
    "message": "Hello! You are client #1 of 2",
    "clientNumber": 1,
    "totalClients": 2,
    "timestamp": "2025-01-01T12:00:05.000Z",
    "uniqueId": "client-1-1704110405000"
  }
}
```

**Client #2 receives:**
```json
{
  "jsonrpc": "2.0",
  "method": "custom/welcome",
  "params": {
    "message": "Hello! You are client #2 of 2",
    "clientNumber": 2,
    "totalClients": 2,
    "timestamp": "2025-01-01T12:00:05.000Z",
    "uniqueId": "client-2-1704110405000"
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `ping` | Check server status and connected client count |
| `broadcast-notification` | Manually send a message to all clients |

## Technical Notes

### Why Stateful Mode?

According to the [MCP transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports):

> "The server MAY send JSON-RPC requests or notifications on the stream"

This requires an active SSE stream, which is only available in stateful mode where:
1. Client sends `initialize` request
2. Server responds with `mcp-session-id` header
3. Client opens GET SSE stream with the session ID
4. Server can push notifications through this stream

### Edge Environment Compatibility

For stateless edge environments (Supabase, Cloudflare Workers):
- Sessions are disabled by default
- Notifications are silently discarded
- Use polling or webhooks instead of push notifications


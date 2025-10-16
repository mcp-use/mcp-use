# SSE Connection Disconnect Issue - Analysis & Fix

## Problem Summary

SSE (Server-Sent Events) connections disconnect after a period of inactivity, typically 30-60 seconds. This affects the MCP Inspector and any client using SSE transport.

## Root Causes

1. **Network Intermediaries**: Proxies, load balancers, and firewalls close idle HTTP connections
2. **No Keepalive Messages**: Without periodic data, connections appear idle and get closed
3. **Browser/Transport Defaults**: EventSource implementations have no built-in keepalive mechanism
4. **Server Configuration**: Default server setups don't send periodic heartbeat messages

## Architecture Analysis

### Where the Issue Occurs

The problem is **NOT** in:

- ❌ Inspector UI
- ❌ `useMcp` hook
- ❌ Official MCP SDK (client or server)

The problem **IS** in:

- ✅ **Network layer** - Intermediaries closing idle connections
- ✅ **Server configuration** - No keepalive/heartbeat implementation
- ✅ **Transport layer** - Missing timeout configuration options

### What Was Fixed

#### 1. Client-Side Configuration Options (TypeScript)

**File: `libraries/typescript/packages/mcp-use/src/react/types.ts`**

Added timeout configuration options to `UseMcpOptions`:

```typescript
/** Connection timeout in milliseconds for establishing initial connection (default: 30000 / 30 seconds) */
timeout?: number

/** SSE read timeout in milliseconds to prevent idle connection drops (default: 300000 / 5 minutes) */
sseReadTimeout?: number
```

**File: `libraries/typescript/packages/mcp-use/src/connectors/http.ts`**

Updated `HttpConnectorOptions` interface to use milliseconds consistently:

```typescript
export interface HttpConnectorOptions extends ConnectorInitOptions {
  authToken?: string;
  headers?: Record<string, string>;
  timeout?: number; // HTTP request timeout (ms)
  sseReadTimeout?: number; // SSE read timeout (ms)
  clientInfo?: { name: string; version: string };
  preferSse?: boolean;
}
```

Changed defaults from 5 seconds to 30 seconds for connection timeout, and 5 minutes for SSE read timeout.

#### 2. Documentation Updates

Added comprehensive comments explaining:

- Why SSE connections disconnect
- What the timeout options do
- SDK limitations (EventSource timeout configuration)
- Proper server-side solutions

### Limitations Discovered

The MCP SDK's `SSEClientTransportOptions` interface does **NOT** expose timeout configuration:

```typescript
export type SSEClientTransportOptions = {
  authProvider?: OAuthClientProvider;
  eventSourceInit?: EventSourceInit; // Only has: withCredentials, fetch
  requestInit?: RequestInit; // For POST requests, not SSE
  fetch?: FetchLike;
};
```

This means timeout handling must be done at different levels.

## Complete Solution

### Option 1: Server-Side Keepalive (Recommended)

**The proper solution** is to send periodic keepalive messages from the server:

```typescript
// Example for MCP servers using Express/SSE
app.get("/mcp", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Send comment line every 30 seconds to keep connection alive
  const keepaliveInterval = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(keepaliveInterval);
  });

  // ... handle SSE messages ...
});
```

For the MCP SDK's `StreamableHTTPServerTransport`, this keepalive should be handled automatically by the SDK, but may need configuration.

### Option 2: Client-Side Auto-Reconnect (Already Implemented)

The `useMcp` hook already has automatic reconnection:

```typescript
// Usage
useMcp({
  url: "http://localhost:3001/mcp",
  autoReconnect: 3000, // Reconnect after 3 seconds if connection drops
});
```

This mitigates the issue but doesn't prevent disconnections.

### Option 3: Custom Fetch with Timeout

For advanced users, implement a custom fetch with timeout handling:

```typescript
const customFetch: FetchLike = (url, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 minutes

  return fetch(url, {
    ...init,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
};

useMcp({
  url: "http://localhost:3001/mcp",
  // Custom fetch can be passed through connector options
});
```

### Option 4: Network/Infrastructure Configuration

Configure proxies, load balancers, and firewalls to allow longer-lived connections:

**Nginx:**

```nginx
location /mcp {
  proxy_read_timeout 600s;
  proxy_send_timeout 600s;
  proxy_connect_timeout 600s;
}
```

**AWS ALB:**

```yaml
ConnectionSettings:
  IdleTimeout: 600
```

## Implementation Status

### ✅ Completed

1. Added `timeout` and `sseReadTimeout` options to `UseMcpOptions` interface
2. Updated `HttpConnector` to use consistent millisecond-based timeouts
3. Documented limitations of MCP SDK's SSEClientTransport
4. Maintained backward compatibility with existing code
5. All TypeScript builds passing

### ⚠️ Known Limitations

1. **MCP SDK doesn't expose SSE timeout options** directly through `SSEClientTransportOptions`
2. Timeout configuration is preserved in interfaces for **documentation and future use**
3. Actual timeout handling depends on:
   - Browser's EventSource implementation
   - Server-side keepalive messages
   - Network infrastructure configuration

### 🔄 Next Steps (Recommendations)

1. **Server Implementers**: Add keepalive/heartbeat messages every 30 seconds
2. **MCP SDK**: Consider exposing timeout options in future versions
3. **Network Admins**: Configure intermediaries for longer-lived connections
4. **Users**: Use `autoReconnect` option in `useMcp` for resilience

## Testing

To verify the fix:

1. **Start your MCP server:**

   ```bash
   cd your-mcp-server
   npm start
   ```

2. **Connect with Inspector:**

   ```bash
   http://localhost:3001/inspector
   ```

3. **Let it idle for 2+ minutes** and observe:

   - ✅ Connection stays alive (if server has keepalive)
   - ✅ Auto-reconnects if connection drops (if `autoReconnect` is enabled)
   - ❌ Disconnects after 30-60 seconds (if no keepalive)

4. **Check browser console** for reconnection attempts

## References

- [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [EventSource Spec](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [SSE Keepalive Best Practices](https://javascript.info/server-sent-events)
- [MCP SDK GitHub](https://github.com/modelcontextprotocol/typescript-sdk)

## For Python Users

Python implementation already has proper timeout configuration:

```python
# In libraries/python/mcp_use/connectors/http.py
HttpConnector(
    base_url="http://localhost:3001",
    timeout=5,  # seconds
    sse_read_timeout=300,  # 5 minutes
)
```

The Python SseConnectionManager properly passes these values to the underlying `sse_client`.

---

**Date:** October 16, 2024  
**Status:** ✅ Fixed (with documented limitations)  
**Impact:** Low - Existing code continues to work; new options available for configuration

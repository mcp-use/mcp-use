# Server Proxying & Composition

The `mcp-use` TypeScript SDK allows you to easily proxy and compose multiple MCP servers into a single unified "Aggregator" server.

This is extremely useful when you have multiple microservices or specialized MCP servers (like a database server, a weather server, and an internal API server) and you want to expose all of their tools, resources, and prompts through a single unified endpoint.

## High-Level API (Config Object)

Pass a configuration object directly to `server.proxy()`. The keys act as the **namespaces** for the child servers to prevent naming collisions.

```typescript
import { MCPServer } from "mcp-use/server";
import path from "node:path";

const server = new MCPServer({ name: "UnifiedServer", version: "1.0.0" });

// The SDK handles all connections, sessions, and synchronization automatically
await server.proxy({
  // Proxy a local TypeScript server (using the 'tsx' runner)
  database: {
    command: "tsx",
    args: [path.resolve(__dirname, "./db-server.ts")]
  },
  
  // Proxy a local Python FastMCP server
  weather: {
    command: "uv",
    args: ["run", "weather_server.py"],
    env: { ...process.env, FASTMCP_LOG_LEVEL: "ERROR" }
  },
  
  // Proxy a remote server over HTTP
  manufact: {
    url: "https://manufact.com/docs/mcp"
  }
});

// Start the unified server
await server.listen(3000);
```

In the example above, the `database` tools will be prefixed with `database_` (e.g. `database_query`), the `weather` tools will be prefixed with `weather_` (e.g. `weather_get_forecast`), and so on. Resource URIs will be prefixed like `database://app://config`.

## Low-Level API (Explicit Session)

For advanced use cases (dynamic auth headers, manual session lifecycles, or custom connectors), you can inject an explicit `MCPSession` directly into the `proxy` method using the `mcp-use/client` SDK.

```typescript
import { MCPServer } from "mcp-use/server";
import { MCPClient } from "mcp-use/client";

const server = new MCPServer({ name: "UnifiedServer", version: "1.0.0" });

// Create a custom client orchestration
const customClient = new MCPClient({
  mcpServers: {
    secure_db: {
      url: "https://secure-db.example.com/mcp"
    }
  }
});

// Manage the session manually
const dbSession = await customClient.createSession("secure_db");

// Proxy the active session, manually specifying the namespace
await server.proxy(dbSession, { namespace: "secure_db" });

await server.listen(3000);
```

## Advanced Features Supported

The `mcp-use` proxying system goes far beyond simple tool forwarding:

1. **Schema Translation**: Automatically translates raw JSON Schemas from child servers into runtime Zod schemas.
2. **LLM Sampling & Elicitation**: Automatically intercepts out-of-band JSONRPC requests (sampling/elicitation) from child servers, resolves the HTTP context of the original user who triggered the tool, and routes the request securely back to that user's client. 
3. **Progress Tracking**: If a child tool emits `notifications/progress/report`, the Aggregator catches and pipes those directly through the unified `ToolContext` back to the parent client.
4. **State Syncing**: The Aggregator listens to `list_changed` events emitted by the child server and instantly forwards them to all connected clients.
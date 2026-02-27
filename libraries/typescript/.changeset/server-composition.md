---
"mcp-use": minor
---

Added robust SDK-level server composition and proxying functionality via `MCPServer.proxy()`.

You can now natively compose multiple disparate MCP servers into a single unified aggregator server. The SDK automatically orchestrates connections, proxies JSON-RPC execution (including tools, prompts, resources, LLM Sampling, Elicitation, and Progress), translates schemas on the fly, prefixes namespaces to prevent collisions, and multiplexes list-changed notifications up to the parent connection.

### Example
```typescript
import { MCPServer } from "mcp-use/server";
const server = new MCPServer({ name: "UnifiedServer", version: "1.0.0" });

await server.proxy({
  database: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://..."]
  },
  weather: {
    url: "https://weather-mcp.example.com/mcp"
  }
});

await server.listen(3000);
```
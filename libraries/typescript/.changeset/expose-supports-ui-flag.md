---
"mcp-use": minor
---

Expose a top-level `supportsUI` flag in the tool context. This allows tool developers to easily check if the connected client supports rich UI elements (widgets, MCP Apps) and return adaptive responses.

Example usage:
```typescript
server.tool("my-tool", async (input, context) => {
  if (context.supportsUI) {
    return widget({ ... });
  }
  return text("Fallback text");
});
```

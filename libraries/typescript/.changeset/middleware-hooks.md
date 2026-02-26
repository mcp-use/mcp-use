---
"mcp-use": minor
---

feat(server): add middleware hooks for intercepting MCP protocol operations

Register per-request middleware with `server.use()` to filter tools, enforce authorization, and add cross-cutting logic. Supports `onListTools`, `onCallTool`, `onListPrompts`, and `onListResources` hooks in an onion-model chain.

```typescript
server.use({
  name: "role-filter",
  onListTools: async (ctx, callNext) => {
    const tools = await callNext();
    return tools.filter((t) => !t.name.startsWith("admin-"));
  },
});
```

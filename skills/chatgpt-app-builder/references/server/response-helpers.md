# Response Helpers (deprecated)

**Deprecated.** Prefer returning official MCP wire envelopes directly:

- Tools: `{ content: [{ type: "text", text }] }` or with `structuredContent`
- Resources: `{ contents: [{ uri, mimeType?, text|blob }] }`
- Prompts: `{ messages: [{ role, content }] }`

Helpers (`text()`, `object()`, `error()`, …) remain exported from `mcp-use` for upgrade compatibility. They return `CallToolResult`; resource/prompt registration converts helper-shaped returns automatically.

## Preferred (raw)

```typescript
server.tool(
  { name: "get-data", inputSchema: z.object({}) },
  async () => {
    const data = { status: "ok", data: [1, 2, 3] };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
);
```

## Deprecated helpers (compat)

```typescript
import { object, text, error } from "mcp-use";

server.tool(
  { name: "get-data", inputSchema: z.object({}) },
  async () => object({ status: "ok", data: [1, 2, 3] })
);
```

| Helper | Prefer |
| --- | --- |
| `text(s)` | `{ content: [{ type: "text", text: s }] }` |
| `object(data)` | `{ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data }` |
| `array(xs)` | `{ content: [{ type: "text", text: JSON.stringify(xs) }], structuredContent: xs }` (no `{ data }` wrap) |
| `error(msg)` | `{ isError: true, content: [{ type: "text", text: msg }] }` |
| `widget({ props, output })` | `view: { name }` + `{ content, structuredContent: props }` |

See docs: `/typescript/server/response-helpers`.

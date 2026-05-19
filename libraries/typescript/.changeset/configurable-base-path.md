---
"mcp-use": minor
---

Add `basePath` option to `MCPServer` for mounting every server route under a configurable prefix.

When `basePath` is set, the MCP transport, inspector UI, widget/public asset routes, OAuth flow + metadata endpoints, and bearer-auth middleware all live under that prefix. For example, with `basePath: "/api"`:

- MCP transport: `POST /api/mcp` and `/api/sse`
- Inspector UI: `GET /api/inspector`
- Widgets: `/api/mcp-use/widgets/*`, public assets: `/api/mcp-use/public/*`
- OAuth metadata: `/api/.well-known/oauth-authorization-server`
- OAuth endpoints: `/api/authorize`, `/api/token`, `/api/register`

`/favicon.ico` continues to be served at the root so browsers' implicit favicon request still resolves. OAuth metadata responses (issuer, authorization_endpoint, etc.) include the prefix so standard discovery works without extra configuration.

```typescript
const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  basePath: "/api",
});
```

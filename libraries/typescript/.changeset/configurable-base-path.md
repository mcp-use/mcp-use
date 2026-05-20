---
"mcp-use": minor
"@mcp-use/cli": minor
---

Add `basePath` option to `MCPServer` and restructure how the framework owns URL and disk space.

### `basePath` config

When `basePath` is set, all user-facing protocol routes mount under that prefix:

- MCP transport: `POST ${basePath}/mcp` and `${basePath}/sse`
- Inspector UI: `GET ${basePath}/inspector`
- OAuth endpoints: `${basePath}/authorize`, `${basePath}/token`, `${basePath}/register`
- OAuth metadata: `${basePath}/.well-known/oauth-authorization-server` (RFC 8414 requires the discovery path at the issuer root, so this must live under `basePath`)
- Bearer-auth middleware and user-registered routes auto-prefix under `basePath`

```typescript
const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  basePath: "/api",
});
```

### Framework asset namespace

Static framework assets escape `basePath` and live at a fixed root namespace, mirroring how Next.js separates `.next/` ↔ `/_next/`:

| Concern         | URL                              | Disk                         |
| --------------- | -------------------------------- | ---------------------------- |
| Widget HTML     | `/_mcp-use/widgets/{name}`       | `.mcp-use/widgets/{name}/`   |
| Widget assets   | `/_mcp-use/widgets/{name}/assets/*` | same                      |
| Public assets   | `/_mcp-use/public/*`             | `.mcp-use/public/*`          |
| Build manifest  | (not served)                     | `.mcp-use/manifest.json`     |
| Server handshake| (not served)                     | `.mcp-use/server-info.json`  |

This means:

- The legacy `${basePath}/mcp-use/widgets/*` and `${basePath}/mcp-use/public/*` routes are gone — replace with `/_mcp-use/widgets/*` and `/_mcp-use/public/*` (bare absolute paths in widget HTML — no baseUrl/basePath interpolation needed).
- `mcp-use build` writes output to `.mcp-use/` instead of `dist/` (widgets to `.mcp-use/widgets/`, public assets to `.mcp-use/public/`, manifest to `.mcp-use/manifest.json`). `dist/` now holds only your own transpiled server code.
- The HTTP discovery endpoint `/__mcp-use/serverinfo` is removed. `MCPServer.listen()` now writes `.mcp-use/server-info.json` (host, port, basePath, mcpUrl, inspectorUrl) for out-of-process tooling to read.
- Dev-mode widget temp directories move under `.mcp-use/.tmp/` so every top-level entry in `.mcp-use/` is a framework namespace.

### Embedder note

If you mount `getHandler()` inside a larger app at some prefix, `/_mcp-use/` lives at the embedder's mount prefix, not the host root. "BasePath-agnostic" means "ignores mcp-use's own basePath config," not "magically escapes the embedder."

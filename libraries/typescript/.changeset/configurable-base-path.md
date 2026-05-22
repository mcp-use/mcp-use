---
"mcp-use": minor
"@mcp-use/cli": minor
---

Add `basePath` option to `MCPServer` and restructure how the framework owns URL and disk space.

### `basePath` config

When `basePath` is set, all framework routes mount under that prefix:

- MCP transport: `POST ${basePath}/mcp` and `${basePath}/sse`
- Inspector UI: `GET ${basePath}/inspector`
- OAuth endpoints: `${basePath}/authorize`, `${basePath}/token`, `${basePath}/register`
- OAuth metadata: `${basePath}/.well-known/oauth-authorization-server` (RFC 8414 requires the discovery path at the issuer root, so this must live under `basePath`)
- Bearer-auth middleware and user-registered routes auto-prefix under `basePath`
- Framework assets: `${basePath}/_mcp-use/widgets/*`, `${basePath}/_mcp-use/public/*`, `${basePath}/favicon.ico`

```typescript
const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  basePath: "/api",
});
```

The only routes that stay at the literal host root are the OAuth `.well-known/*` discovery endpoints — those are pinned to the host root by RFC 8414 / RFC 9728. Everything else lives under `basePath`.

### Framework asset namespace

Static framework assets live at `${basePath}/_mcp-use/*`, mirroring how Next.js separates `.next/` ↔ `/_next/`:

| Concern          | URL                                            | Disk                         |
| ---------------- | ---------------------------------------------- | ---------------------------- |
| Widget HTML      | `${basePath}/_mcp-use/widgets/{name}`          | `.mcp-use/widgets/{name}/`   |
| Widget assets    | `${basePath}/_mcp-use/widgets/{name}/assets/*` | same                         |
| Public assets    | `${basePath}/_mcp-use/public/*`                | `.mcp-use/public/*`          |
| Favicon          | `${basePath}/favicon.ico`                      | `public/favicon.ico`         |
| Build manifest   | (not served)                                   | `.mcp-use/manifest.json`     |
| Server handshake | (not served)                                   | `.mcp-use/server-info.json`  |

This means:

- The legacy `${basePath}/mcp-use/widgets/*` and `${basePath}/mcp-use/public/*` routes are gone — they're now under `_mcp-use/`.
- `mcp-use build` writes output to `.mcp-use/` instead of `dist/` (widgets to `.mcp-use/widgets/`, public assets to `.mcp-use/public/`, manifest to `.mcp-use/manifest.json`). `dist/` now holds only your own transpiled server code.
- The HTTP discovery endpoint `/__mcp-use/serverinfo` is removed. `MCPServer.listen()` now writes `.mcp-use/server-info.json` (host, port, basePath, mcpUrl, inspectorUrl) for out-of-process tooling to read.
- Dev-mode widget temp directories move under `.mcp-use/.tmp/` so every top-level entry in `.mcp-use/` is a framework namespace.

Browsers won't pick up favicons at `${basePath}/favicon.ico` automatically (they only probe the host root). The MCP server's `icons` config — which the SDK exposes via `getServerInfo` — is the authoritative reference for clients that need to display an icon.

### Production widget HTML self-resolves basePath

`mcp-use build` bakes `window.__getFile` and `window.__mcpPublicUrl` into the built widget HTML in a way that *resolves the server's basePath at runtime* from `window.location.pathname`. The same built bundle works whether the server is mounted at `/` or under any `basePath`, with no rebuild needed.

Two related behavior changes:

- **`<base href>` is no longer injected** into widget HTML. If a widget relied on relative URLs resolving against the server origin root, switch to absolute paths (`/mcp`, `/_mcp-use/public/...`) or read `window.__mcpPublicUrl`.
- **`setupPublicRoutes` is no longer used in production.** The export is still available for embedders that hand-roll their own server but want the dev-mode helper that serves from `./public/`.

Runtime gate: Deno keeps hand-rolled handlers (Deno doesn't load `@hono/node-server`); Node and Bun use `serveStatic`.

### Embedder note

If you mount `getHandler()` inside a larger app at some prefix, `/_mcp-use/` lives at the embedder's mount prefix combined with mcp-use's own `basePath`.

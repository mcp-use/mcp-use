---
"mcp-use": minor
"@mcp-use/inspector": minor
"@mcp-use/cli": patch
---

feat(server): configurable mount paths for MCP, widgets, inspector, and OAuth

`ServerConfig` accepts a new optional `routes` field that relocates every
HTTP mount on the server. Defaults preserve existing behavior.

```ts
new MCPServer({
  name: "my-server",
  version: "1.0.0",
  routes: {
    mcpBasePath: "/api/mcp",        // default "/mcp"
    sseBasePath: "/api/sse",        // default "/sse"
    widgetsBasePath: "/ui/widgets", // default "/mcp-use/widgets"
    publicBasePath: "/ui/static",   // default "/mcp-use/public"
    inspectorBasePath: "/debug",    // default "/inspector"
    oauthBasePath: "/auth",         // default ""
  },
});
```

Beyond the surface route config, this release threads the resolved paths through:

- `mcp-use`: MCP/SSE transports, OAuth provider endpoints (`/authorize`,
  `/token`, `/register`, `/.well-known/*`), widget pages, widget URI builder
  (`buildWidgetUrl`), public static files, favicon, and the request-logger
  quiet-route filter (`createRequestLogger`).
- `@mcp-use/inspector`: `mountInspector` accepts a `basePath` that truly
  remounts the inspector — backend routes (health, API, chat, tunnel,
  dev-info, MCP/OAuth proxies, MCP Apps), static asset paths, the served
  HTML's Vite-baked asset references, the React Router `basename`, and
  OAuth callback URLs all follow the configured mount. The redirect-only
  alias from the previous release has been removed.
- `@mcp-use/cli`: dev banner and inspector auto-open URL read the running
  server's `routeConfig` so `MCP:` and `Inspector:` lines match the active
  mounts. `waitForServer` health probe also uses the configured inspector
  base path.

Migration: no action required if you don't set `routes`. If you do set
`inspectorBasePath`, the inspector is now genuinely mounted only at that
path — the previous redirect from the configured path to `/inspector` is
gone, and `/inspector/*` no longer serves the SPA fallback in embedded mode.

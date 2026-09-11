# Embedded MCP server in TanStack Start

This example serves a TanStack Start website and an mcp-use server from one
application. Start owns the listener; MCP is mounted at `/api/mcp`.

From this directory, run `pnpm dev` and open http://localhost:3000. Connect an
MCP client to http://localhost:3000/api/mcp and call `greet` or `show-status-card`.
The card component is shared by the website and the MCP App view.

The integration has three parts:

- `src/mcp/server.ts` default-exports an `MCPServer`, without calling `listen()`.
- `vite.config.ts` adds `mcpUseTanStackStart` from `mcp-use/tanstack-start/vite`
  before the Start and React plugins.
- `src/routes/api.mcp.$.ts` forwards requests to `createTanStackStartHandler`
  from `mcp-use/tanstack-start`, including nested MCP asset paths.

The plugin compiles views when Vite starts. Restart `pnpm dev` after changing
views, shared view components, public assets or skills. This initial integration
does not provide widget HMR. Browser-safe components and tsconfig aliases work
in views; Start server functions and router context are not available there.

The view build is isolated from the application's Vite config. React and
Tailwind support are included; use the plugin's `viewsConfig` option for a
separate view-only Vite configuration if needed. Do not put Start, Nitro or
`mcpUseTanStackStart` in that separate configuration.

Configure CORS on `MCPServer`, as shown here. When adding OAuth, configure its
public resource URL and keep the `/.well-known/oauth-protected-resource/$`
route forwarding to the same handler. It returns 404 while OAuth is disabled.

## Production and verification

```sh
pnpm build
pnpm start
pnpm verify
```

This example targets React + Vite + Node using Nitro's `node-server` preset.
The MCP manifest, view bundles, public assets and skills are embedded in the
server build; `.mcp-use/` and the source files are not runtime dependencies.
Embedding assets increases the server bundle size. Deploy Nitro's complete
`.output/` directory, which also contains the website's client assets.

`pnpm verify` builds the example and checks MCP negotiation, tool calls, view
resources, generated bundles, public assets, CORS, HEAD and the rendered website.
Workspace contributors must build `@mcp-use/cli`, `mcp-use` and
`@mcp-use/client` first. TanStack's generated `src/routeTree.gen.ts` is checked in
so typechecking works before the first Vite invocation.

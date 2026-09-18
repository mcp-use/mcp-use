# MCP with TanStack Start and Vite environments

This example serves a TanStack Start website and an mcp-use server from one
application. Start owns the listener; MCP is mounted at `/api/mcp`.

Run `pnpm dev`, open http://localhost:3000, and connect an MCP client to
http://localhost:3000/api/mcp. Call `greet` or `show-status-card`. The card
component is shared by the website and the MCP App view.

## Integration

- `src/mcp/server.ts` default-exports an `MCPServer`, without calling `listen()`.
- `vite.config.ts` places `mcpUseTanStackStart()` before Start, Nitro and React.
- `src/mcp/handler.server.ts` calls `createTanStackStartHandler()` with no argument.
  Do not import the authored server into Start's route graph.
- The MCP catch-all and OAuth discovery routes forward to that same handler.

`mcpUseTanStackStart()` wraps the reusable `mcpUse()` plugin exported from
`mcp-use/vite`. Both accept `entry`, `viewsDir`, and `basePath`. The base path
must match the authored server. `viewsConfig` has been removed: configure
aliases, React, and CSS plugins in the application's Vite config. Import any
application/Tailwind stylesheet needed by a view from that view or a shared
component; the integration does not inject a second Tailwind setup.

## Development

The `mcp` Vite environment owns the MCP entry and its dependency graph. Views
share the website's `client` environment and HMR websocket. Start/Nitro can run
routes in a worker; a private streaming endpoint on the existing Vite listener
forwards requests to the MCP environment without another port.

- View and CSS edits use React Fast Refresh/HMR, preserving state where React
  supports it. Shared components update in both the website and MCP iframe.
- Server edits prepare a replacement, switch to it, and close the old instance.
  Active MCP exchanges are interrupted. Calls are not automatically retried.
- Failed server edits retain the last working instance. Fixing the file reloads
  it without restarting Vite.
- Adding/removing views or editing skills refreshes MCP registrations. Adding
  the first view also works without restarting.
- Public assets are read from the source directory on each request.

Configure MCP endpoint CORS on `MCPServer`. Browser modules use Vite's
`server.cors` policy; the integration's default also permits opaque (`null`)
iframe origins. Configure `server.origin`, `server.hmr`, and `server.cors` in
Vite when using a public development URL or a host with another iframe origin.

Browser-safe shared components work in views. Start router context and server
functions are not automatically available inside an MCP iframe.

## Production and verification

```sh
pnpm build
pnpm start
pnpm verify
```

This example targets React + Vite 8 + Node using Nitro's `node-server` preset.
Production builds views in a separate `mcpViews` environment because Start's
client manifest requires a single application entry. That build uses relative
asset URLs suitable for embedded views. The `mcp` build embeds view bundles,
public assets and skills, and Start/Nitro packages the compiled MCP handler.
Deploy the complete `.output/` directory. Source files and `.mcp-use/` are not
runtime dependencies; embedding assets increases the server bundle size.

`pnpm verify` checks MCP negotiation, tool calls, views, generated bundles,
public assets, CORS, HEAD and the rendered website in the production output.
Workspace contributors can also run `pnpm verify:dev` to launch Chromium and
verify shared-component state preservation, CSS HMR, server edits and error
recovery in an opaque-origin MCP iframe. It uses the workspace Inspector's
Playwright installation. Run `pnpm verify:dev --production` to verify a
production iframe with CSS, imported images and lazy chunks after removing
the test source checkout. Build `@mcp-use/tunnel`, `@mcp-use/cli`, `mcp-use` and
`@mcp-use/client` before running these checks.

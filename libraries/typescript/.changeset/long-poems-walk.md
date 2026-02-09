---
"mcp-use": minor
"@mcp-use/inspector": patch
"@mcp-use/cli": patch
---

Improve reverse proxy support, HMR reliability, and widget handling across the stack.

### `mcp-use` (minor)

- **Custom HTTP route HMR:** Routes registered via `server.get()`, `server.post()`, etc. now support hot module replacement — handlers are hot-swapped without a server restart.
- **Widget tool protection during HMR:** Widget-registered tools are no longer accidentally removed when `index.ts` HMR sync runs. Tools tagged with `_meta["mcp-use/widget"]` are preserved.
- **Dynamic widget creation:** The `resources/` directory is auto-created if missing, and the dev server watches for new widgets even if none exist at startup. This enables workflows where widgets are created after the server starts
- **Vite HMR WebSocket proxy:** A TCP-level WebSocket proxy forwards HMR `upgrade` requests from the main HTTP server to Vite's internal HMR port, enabling hot-reload through reverse proxies (ngrok, E2B, Cloudflare tunnels).
- **`MCP_URL` environment variable:** Can now be pre-set by users to an external proxy URL. The CLI will not overwrite it, allowing correct widget URLs and HMR WebSocket connections behind reverse proxies.
- **List-changed notifications on removal:** `sendToolListChanged()`, `sendResourceListChanged()`, and `sendPromptListChanged()` now also fire when items are removed, not just added/updated.
- **Pre-initialized request handlers:** Tool, prompt, and resource request handlers are pre-registered during session initialization, preventing `Method not found` errors when clients connect to servers that start with zero registrations and add them dynamically.
- **Widget type default changed:** Widgets now default to `mcpApps` (dual-protocol) instead of `appsSdk`. Only widgets with explicit `appsSdkMetadata` and no `metadata` field use the `appsSdk` type.
- **`window.__mcpServerUrl` global:** Injected into widget HTML so widgets can dynamically construct API URLs (e.g., `fetch(window.__mcpServerUrl + '/api/data')`).

### `@mcp-use/inspector` (patch)

- **`MCP_INSPECTOR_FRAME_ANCESTORS` env var:** Controls which origins can embed the inspector in iframes via CSP `frame-ancestors`. Defaults to `*` in development and `'self'` in production.
- **`mountInspector` configuration options:** Accepts new `devMode` (boolean) and `sandboxOrigin` (string | null) options for controlling sandbox behavior in different deployment environments.
- **Runtime config injection:** `__MCP_DEV_MODE__` and `__MCP_SANDBOX_ORIGIN__` window globals are injected into the served HTML at runtime, enabling client-side configuration without rebuild.
- **Localhost URL conversion:** Server-side fetches of widget HTML now convert external proxy URLs to `localhost` to avoid reverse proxy catch-all routes returning SPA HTML instead of Vite-served widget content.
- **Simplified URL rewriting:** Widget asset URLs are now rewritten to bare server-relative paths that resolve directly through Vite middleware, improving reliability behind reverse proxies.
- **Fixed infinite re-render loop:** Removed excessive `useEffect` dependencies in `MCPAppsRenderer` that caused continuous re-fetching of widget HTML.

### `@mcp-use/cli` (patch)

- **Respect user-provided `MCP_URL`:** The CLI no longer overwrites `MCP_URL` if already set, allowing users to configure external proxy URLs for reverse proxy setups.

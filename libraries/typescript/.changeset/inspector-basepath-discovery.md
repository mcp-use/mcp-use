---
"@mcp-use/inspector": minor
---

Discover the embedding host's `basePath` at runtime and prefix all same-origin URLs with it.

When the inspector is embedded in an `MCPServer` configured with a `basePath` (e.g. `"/api"`), the server injects the prefix into a `window.__MCP_BASE_PATH__` global on the served HTML. New `getBasePath()` / `inspectorPath()` helpers in `client/utils/basePath.ts` read that global so React Router's `basename`, fetch URLs (proxy, telemetry, dev info, tunnel, chat stream, widget store), and config endpoints route to the prefixed paths. Standalone/CDN mode and unprefixed deployments keep the existing bare-path behavior because the global is absent.

Server-side: `shared-static` and `middleware` inject the global into served HTML; `vite.config.ts` keeps `/inspector` as the dev base.

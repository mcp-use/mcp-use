---
"mcp-use": major
"@mcp-use/cli": major
"@mcp-use/inspector": minor
"create-mcp-use-app": minor
---

v2 config/build/basePath rework (MCP-2601, MCP-2613):

- The `mcp-use.config.json` config file, its loader, and the generated JSON schema are removed. Server shape is expressed on the `MCPServer` constructor (`basePath`, `viewsDir`, `publicDir`, `assetPrefix`) and introspected by the CLI off the imported entry.
- Build output and scratch move from `dist/` to the per-project `.mcp-use/` workspace (`.mcp-use/build`, `.mcp-use/cache`).
- The MCP mount path is configurable via the `basePath` constructor option (default `/mcp`); widgets, public assets, OAuth routes, and the inspector all relocate under it.
- `config.baseUrl` is removed — the canonical public origin comes from the `MCP_URL` env var (resolved by both `listen()` and `getHandler()`), with per-request inference from proxy headers.
- `assetPrefix` (constructor) replaces the `MCP_SERVER_URL` env var for off-server/static widget asset hosting.
- Debug env vars (`DEBUG`, `MCP_DEBUG_LEVEL`, `VERBOSE`) are consolidated into a single `MCP_USE_LOG_LEVEL` (`error`–`trace`).

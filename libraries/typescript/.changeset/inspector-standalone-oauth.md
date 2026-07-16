---
"@mcp-use/inspector": patch
"@mcp-use/client": patch
---

Fix standalone Inspector OAuth and CDN delivery.

**@mcp-use/inspector**
- Serve the built UI from `dist/cdn/` locally in standalone mode (`pnpm start` / `npx`); embedded mounts still default to jsDelivr `@beta`.
- Point `pnpm start` at `dist/cli.js` so standalone runs the full proxy + OAuth BFF shell.
- Skip `dev/info` tunnel probes in standalone mode (route exists only under `mcp-use dev`).
- Simplify e2e matrix: builtin/prod modes rely on in-process static assets instead of a separate CDN fixture server.
- Document jsDelivr-first embedding vs local standalone in `docs/inspector/integration.mdx`.

**@mcp-use/client**
- Fix Linear (and other OAuth) redirect flows: do not auto-connect saved MCP servers on `/oauth/callback`, which overwrote the PKCE verifier before token exchange.
- Stop HEAD health-check polling after a 405/404 from servers that only accept POST (reduces console noise for providers like Linear).

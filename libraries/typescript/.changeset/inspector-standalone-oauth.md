---
"@mcp-use/inspector": patch
"@mcp-use/client": patch
---

Fix standalone Inspector OAuth and local application delivery.

**@mcp-use/inspector**
- Serve the installed UI bundle from `dist/app/` in local standalone mode (`pnpm start` / `npx`).
- Point `pnpm start` at `dist/cli.js` so standalone runs the full proxy + OAuth BFF shell.
- Skip `dev/info` tunnel probes in standalone mode (route exists only under `mcp-use dev`).
- Simplify e2e matrix: builtin/prod modes rely on in-process static assets.
- Document project-local development mounting in `docs/inspector/integration.mdx`.

**@mcp-use/client**
- Fix Linear (and other OAuth) redirect flows: do not auto-connect saved MCP servers on `/oauth/callback`, which overwrote the PKCE verifier before token exchange.
- Stop HEAD health-check polling after a 405/404 from servers that only accept POST (reduces console noise for providers like Linear).

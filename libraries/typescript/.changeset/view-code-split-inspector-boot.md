---
"mcp-use": patch
"@mcp-use/inspector": patch
"create-mcp-use-app": patch
---

Enable MCP view JS code splitting and polish inspector boot UX.

**mcp-use**

- Enable rolldown code splitting for per-view client builds (`chunkFileNames` alongside the entry chunk); update `VIEWS_SPEC.md` for external assets and split chunks.
- Paint a centered boot spinner in the managed inspector shell while the CDN bundle downloads.

**@mcp-use/inspector**

- Match the boot spinner placeholder in the CDN inspector shell.
- Add top margin to tool error banners in the result panel.

**create-mcp-use-app**

- Fix scaffold README inspector links to `${basePath}/inspector` (`/mcp/inspector` by default).
- Align the mcp-apps `mcp-env.d.ts` template comment with the auto-generated shim.

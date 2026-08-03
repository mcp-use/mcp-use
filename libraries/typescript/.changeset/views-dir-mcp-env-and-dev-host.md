---
"mcp-use": minor
"@mcp-use/client": minor
"@mcp-use/inspector": patch
"create-mcp-use-app": minor
---

Align view authoring layout, typing shims, and local dev host behavior across the v2 stack.

**mcp-use**

- Move file-based view sources from `resources/` to `views/` (wire exposure stays MCP resources).
- Replace root `tools.d.ts` with `mcp-env.d.ts`, adding CSS module typing plus the live `Register` import shim; dev/build create it exclusively when absent.
- Simplify favicon selection to the first icon (or explicit `favicon` config).
- Auto-respawn the dev tunnel on disconnect with exponential backoff and subdomain fallback.

**@mcp-use/client**

- Add `mockOpenAiFileApis` on `ViewRenderer` and export `injectOpenAiFileApis` so `useFiles()` works in inspector and other local hosts.
- Advertise host `message` capability by default.

**@mcp-use/inspector**

- Enable `mockOpenAiFileApis` in view preview and standalone host props.

**create-mcp-use-app**

- Refresh starter, blank, and MCP Apps scaffolds for `views/`, `mcp-env.d.ts`, webp demo assets, and the expanded product-search carousel template.

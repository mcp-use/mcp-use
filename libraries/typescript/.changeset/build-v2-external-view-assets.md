---
"mcp-use": minor
---

Revamp the production view build pipeline and deployment env surface.

- **`mcp-use build`** emits hashed view assets on disk (`kind: "external"`) instead of inlining JS/CSS into the manifest; production serves bundles from `${basePath}/_mcp-use/views/<name>/`.
- Add **`--with-inspector`** so the build manifest records inspector availability for `mcp-use start` (no longer always `true`).
- Support **`MCP_ASSETS_URL`** at build time (rewrite manifest asset paths to CDN URLs) and runtime (resolve view `publicBase` and asset hrefs separately from **`MCP_URL`** server origin).
- Add global CSP env: **`CSP_URLS`** (all four MCP Apps categories) and **`CSP_*_DOMAINS`** per-category overrides, merged with author `view.csp` before MCP auto-append.
- Bundle **`@modelcontextprotocol/client`** as a runtime dependency for the CLI.

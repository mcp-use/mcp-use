---
"mcp-use": patch
"@mcp-use/cli": patch
---

`mcp-use dev` loads view modules from the dev server when `MCP_ASSETS_URL` is set, for example in `.env`. Previously the dev view document pointed `/@vite/client`, the view module and its import map at the `MCP_ASSETS_URL` prefix, which can't serve them, so every view stayed on its loading spinner in dev. The view's CSP now allows the dev server origin instead of the CDN. Production views still load from `MCP_ASSETS_URL`, and `mcp-use dev` now says so at startup, pointing to `mcp-use build && mcp-use start` for testing CDN assets locally.

---
"@mcp-use/cli": patch
---

Fix Windows crash in `mcp-use dev` and `mcp-use generate-types` where raw OS paths (e.g. `C:\project\index.ts`) were passed to `tsImport` instead of `file://` URLs, causing `ERR_UNSUPPORTED_ESM_URL_SCHEME`.

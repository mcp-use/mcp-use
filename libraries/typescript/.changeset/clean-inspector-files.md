---
"@mcp-use/inspector": patch
---

Remove 18 unused inspector source files flagged by the TypeScript workspace Knip check, and stop generating the unused client-side `version.ts` (the client reads the version from the `window.__INSPECTOR_VERSION__` global injected by the server).

---
"@mcp-use/cli": patch
---

Join Inspector and dev-API paths through a single `basePath` rule so they work when `basePath` is `"/"`. Previously `inspector-route.ts` and `dev-api.ts` interpolated directly and produced `//inspector`, while `views/document.ts` special-cased the root, so `mcp-use start --with-inspector` advertised `/inspector` but only matched `//inspector` and fell through to the MCP handler. `mcp-use dev` now also prints `/inspector` instead of `//inspector`. Nested `basePath` values are unaffected.

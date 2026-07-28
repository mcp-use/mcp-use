---
"mcp-use": patch
---

Remove the temporary v1 compatibility layer from the v2 beta:

- Remove the `mcp-use/server` export and legacy v1 server facade.
- Remove legacy `resources/<name>/widget.tsx` discovery and React widget adapters.
- Keep the v2 package, CLI, docs, and examples focused on the native `mcp-use` API.

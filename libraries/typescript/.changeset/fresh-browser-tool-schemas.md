---
"@mcp-use/client": patch
---

Refresh cached tool schemas and retry once when a browser MCP call is rejected for mismatched parameter headers. Explicit tool discovery now refreshes both SDK and connector caches.

Keep automatic and explicit discoveries ordered so stale responses cannot replace newer schemas or repopulate a disconnected client's cache. Document the cache and browser recovery behavior.

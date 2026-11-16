---
"@mcp-use/client": patch
---

Browser MCP calls rejected for mismatched parameter headers now refresh cached tool schemas and retry once. Explicit tool discovery now refreshes both SDK and connector caches.

Automatic and explicit discoveries are ordered so stale responses cannot replace newer schemas or repopulate a disconnected client's cache. The client documentation describes the cache and browser recovery behavior.

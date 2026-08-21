---
"@mcp-use/client": patch
---

Give each `useMcp` connection Effect its own client lifecycle so stale connection attempts, cleanup, OAuth callbacks, proxy fallback, health checks, and inventory refreshes cannot overwrite or disconnect a newer connection.

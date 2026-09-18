---
"@mcp-use/client": patch
---

Restore SDK progress and cancellation notification handling by forwarding the SDK handler arguments. Remove obsolete SDK v2 beta progress workarounds, including the extra HTTP SSE reader, and preserve progress routing across concurrent calls and multi-round retries.

---
"mcp-use": patch
---

Reduce v2 Node server startup and request overhead with a conditioned,
self-contained Node entry, buffered JSON response writes, and narrower
JSON-RPC response guards. Preserve the Node-free edge entry, streaming
responses, middleware behavior, and protocol validation.

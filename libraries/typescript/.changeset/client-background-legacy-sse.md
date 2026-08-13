---
"@mcp-use/client": patch
---

Stop blocking legacy HTTP connection readiness for up to five seconds while the optional standalone SSE stream attaches. Notification and reverse-RPC handlers are now registered before the handshake so request/response operations can proceed immediately without racing inbound messages.

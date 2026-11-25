---
"@mcp-use/client": patch
---

Reset stdio sessions when their server exits so reconnection creates a fresh client and transport. Wait for pending cleanup when automatically initializing a session. Preserve concurrent reconnects, drain buffered stderr independently of connection cleanup, and handle delayed writes without closing the caller-owned log stream.

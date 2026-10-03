---
"@mcp-use/client": patch
---

Ensure `StdioConnectionManager` joins in-flight SDK transport close and awaits predecessor child process exit to prevent dual-process overlap on failed handshake and retries.

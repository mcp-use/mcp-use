---
"@mcp-use/client": patch
---

Prevent duplicate subprocesses and HTTP transports from concurrent connection attempts. Coordinate connection and disconnection calls so a later disconnect cancels in-flight and queued reconnects, releasing resources before shutdown completes.

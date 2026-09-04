---
"@mcp-use/inspector": patch
---

Release the upstream stream when an Express client disconnects mid-response. The Express adapter's proxy loop had no abort wiring, so a client that went away during a long-lived SSE response left the loop writing to a dead socket and the upstream connection open until it ended on its own.

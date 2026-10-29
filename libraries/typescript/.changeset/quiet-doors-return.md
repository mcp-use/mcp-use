---
"@mcp-use/client": patch
---

Disconnect sessions whose initialization fails before they enter the client's session map, preventing orphaned transports during failed connections and OAuth retries.

---
"@mcp-use/tunnel": patch
---

fix(tunnel): ignore a relay `cancel` for a request that already finished instead of closing the tunnel and dropping every other in-flight request

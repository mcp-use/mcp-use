---
"@mcp-use/client": patch
---

Close completed Node OAuth loopback callback connections so HTTP keep-alive clients do not keep the authorization flow alive.

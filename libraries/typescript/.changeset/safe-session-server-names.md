---
"@mcp-use/client": patch
---

Handle server names matching Object.prototype properties in the session registry. This ensures missing sessions return null and servers named `__proto__` are disconnected during client cleanup.

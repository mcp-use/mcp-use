---
"@mcp-use/client": patch
---

Propagate initial tool-discovery failures so sessions report server errors, transport failures, and timeouts instead of succeeding with an empty tool cache. Servers without tools and servers returning MethodNotFound retain their existing empty-list behavior.

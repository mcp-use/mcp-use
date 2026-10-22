---
"mcp-use": patch
---

Preserve the `isError` flag when `mix()` combines failed tool results, so clients do not treat a combined error response as a success.

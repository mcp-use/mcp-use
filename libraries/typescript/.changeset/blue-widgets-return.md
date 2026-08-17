---
"@mcp-use/client": patch
---

fix the OpenAI compatibility shim to return a promise from `setWidgetState`, preserving the v1 `useWidget()` contract while keeping native v2 MCP Apps behavior unchanged.

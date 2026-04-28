---
"@mcp-use/inspector": patch
---

Fix MCP App widget overlaying the chat header. Removed the explicit `z-20`/`z-10` stacking context from the sandboxed iframe wrappers in `MCPAppsRenderer` and `OpenAIComponentRenderer` so widgets scroll beneath the chat header instead of painting over it.

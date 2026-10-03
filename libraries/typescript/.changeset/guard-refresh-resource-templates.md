---
"@mcp-use/client": patch
---

Guard `useMcpOperations.refreshResourceTemplates` when the connection is not ready, and handle server errors gracefully to prevent unhandled promise rejections in `refreshAll`.

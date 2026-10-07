---
"mcp-use": patch
---

Prevent request logging from buffering SSE responses so tool progress and log notifications reach clients before tool completion. SSE response bodies are skipped at every logging level, including trace, while finite JSON outcome logging is preserved.

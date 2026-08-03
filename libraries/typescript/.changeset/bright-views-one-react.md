---
"mcp-use": patch
"@mcp-use/cli": patch
---

Keep `mcp-use/react` out of Vite's dependency bundle while explicitly optimizing its CommonJS React dependencies, and apply React deduplication at the dev server's final config layer. This makes dependency and view imports share one React dispatcher.

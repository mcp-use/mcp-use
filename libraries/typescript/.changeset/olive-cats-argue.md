---
"@mcp-use/cli": patch
---

Stop loading the React plugin in the binding-validation server. The server performs build-time binding validation and does not need JSX transformation; loading the plugin caused Vite to add `react`, `react-dom` and the JSX runtimes to `optimizeDeps`, where they may be unresolved in projects without React dependencies. A fresh `mcp-server`, `blank` or `starter` project no longer prints four "Failed to resolve dependency" warnings on its first build.

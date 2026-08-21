---
"@mcp-use/cli": patch
---

Stop loading the React plugin in the binding-validation server. That server only runs for projects with no views, so it has no JSX to transform, and the plugin pulled react, react-dom and the jsx runtimes into `optimizeDeps` where they cannot resolve. A fresh `mcp-server`, `blank` or `starter` project no longer prints four "Failed to resolve dependency" warnings on its first build.

---
"@mcp-use/inspector": patch
---

Restore mcp-use as both a dependency and peerDependency. The dependency is needed for tsup to bundle non-React subpaths (mcp-use/auth, mcp-use/browser) with their transitive deps (langchain). The peerDependency ensures mcp-use/react types are shared with the host app.

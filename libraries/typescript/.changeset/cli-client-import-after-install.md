---
"@mcp-use/cli": patch
---

Load `@mcp-use/client` right after `mcp-use client` or `mcp-use screenshot` auto-installs it. On Node 24 the first run installed the package but still reported `@mcp-use/client is not installed`: the failed import before the install left Node with a cached lookup, so resolving the package name again pointed at a nonexistent `index.js`. The CLI now imports the installed entry file directly, as it already did for its sandbox install.

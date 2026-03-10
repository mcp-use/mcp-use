---
"@mcp-use/cli": patch
---

Fix `mcp-use build` hanging after completion by adding `process.exit(0)` to the build command's success path

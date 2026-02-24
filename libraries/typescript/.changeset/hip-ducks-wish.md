---
"@mcp-use/cli": patch
"create-mcp-use-app": patch
---

Remove deprecated @types/tar dependency and update tar to latest version. The tar package now includes its own TypeScript definitions, making @types/tar redundant.

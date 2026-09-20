---
"create-mcp-use-app": patch
---

Add `types: ["node"]` to the template tsconfigs. The templates install `@types/node` with TypeScript 7, which no longer loads `@types` packages on its own, so `mcp-use typecheck` failed with TS2591 on the first `process.env` read or `node:` import.

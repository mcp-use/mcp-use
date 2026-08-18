---
"@mcp-use/inspector": patch
---

Add a `test` script so the workspace-wide `pnpm test` includes the inspector's unit tests. `pnpm run -r test` skipped the package silently, since only `test:unit` existed.

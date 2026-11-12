---
"@mcp-use/cli": patch
---

`mcp-use client` / `mcp-use screenshot` no longer reinstall `@mcp-use/client` over a copy the project already has, and when an install is needed they use the project's package manager (detected from its lockfile — pnpm, yarn, bun or npm) instead of always npm from the `npx` user agent. Fixes the npm "Cannot read properties of null" crash and the stray `package-lock.json` in pnpm projects (#3081).

---
"mcp-use": patch
---

Downgrade chalk to v4 to fix CJS builds. chalk 5 is ESM-only and is kept external by tsup, so the CJS bundle's `require("chalk")` on Node ≥ 22 returned the module namespace instead of the chalk instance, crashing CJS-built backends (e.g. the Next.js template) on startup with `TypeError: import_chalk.default.gray is not a function`.

---
"create-mcp-use-app": patch
---

Print `pnpm run deploy` instead of `pnpm deploy` in the post-scaffold summary. `deploy` is also a built-in pnpm command, so on pnpm 9 and 10 `pnpm deploy` failed with `ERR_PNPM_CANNOT_DEPLOY` instead of running the project's `deploy` script.

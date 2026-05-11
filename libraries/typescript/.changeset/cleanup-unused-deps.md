---
"mcp-use": patch
"@mcp-use/cli": patch
"create-mcp-use-app": patch
---

Remove unused dependencies and devDependencies flagged by `knip`.

- Root: drop `lint-staged` and `typescript-eslint` (unused; ESLint config uses `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` directly, and Husky pre-commit runs `pnpm format`/`lint:fix` directly without lint-staged). Removed the stale root `lint-staged` config block.
- `@mcp-use/cli`: drop `globby`, `ws`, `@types/ws` (no source references; `globby` was explicitly replaced by Node built-ins). Removed `globby` from `tsup.config.ts` `noExternal`.
- `create-mcp-use-app`: drop `fs-extra` and `@types/fs-extra` (no source references).
- `mcp-use`: drop `ws`, `@types/ws`, `@antfu/eslint-config`, `@langchain/anthropic` (devDep — already an optional peer; only referenced as a string for dynamic import), `eslint-plugin-format`, `lint-staged`. Removed the stale package-level `lint-staged` config block.
- `knip.json`: ignore `@mcp-use/inspector` for the `cli` package (resolved dynamically via `createRequire().resolve` to read its `package.json`).

`pnpm knip:deps` now reports 0 unused (dev)dependencies. `pnpm install --frozen-lockfile`, `pnpm lint`, and `pnpm build` all succeed.

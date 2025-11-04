---
"create-mcp-use-app": patch
"@mcp-use/inspector": patch
"mcp-use": patch
"@mcp-use/cli": patch
---

Standardize code formatting with ESLint + Prettier integration

- Add Prettier for consistent code formatting across the monorepo
- Integrate Prettier with ESLint via `eslint-config-prettier` to prevent conflicts
- Configure pre-commit hooks with `lint-staged` to auto-format staged files
- Add Prettier format checks to CI pipeline
- Remove `@antfu/eslint-config` in favor of unified root ESLint configuration
- Enforce semicolons and consistent code style with `.prettierrc.json`
- Exclude markdown and JSON files from formatting via `.prettierignore`

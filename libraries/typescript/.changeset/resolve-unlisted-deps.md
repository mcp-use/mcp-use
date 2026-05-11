---
"mcp-use": patch
---

Declare `jsdom` and `@vitest/coverage-v8` as explicit devDependencies (resolves `pnpm knip` unlisted-dependency warnings). `@vitest/coverage-v8` is pinned to `~4.0.18` to match the installed `vitest` and satisfy its exact peer-dep constraint.

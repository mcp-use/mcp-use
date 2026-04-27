---
"@mcp-use/inspector": patch
---

Adopt Knip at the workspace root to detect unused files, exports, and dependencies across the TypeScript monorepo. The per-package `knip` devDependency, `knip.json`, and `check-deps` script in `@mcp-use/inspector` are consolidated into a single root-level `knip.json` and root `knip` / `knip:deps` / `knip:production` scripts. No runtime or public API changes.

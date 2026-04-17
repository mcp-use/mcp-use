---
"@mcp-use/inspector": patch
---

Adopt Knip at the workspace root to detect unused files, exports, and dependencies across the TypeScript monorepo. The per-package `knip` devDependency and `knip.json` in `@mcp-use/inspector` are consolidated into a single root-level `knip.json`; the `check-deps` script now delegates to the root install. No runtime or public API changes.

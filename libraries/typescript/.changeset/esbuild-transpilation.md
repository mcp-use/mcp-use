---
"@mcp-use/cli": minor
---

feat: use esbuild for transpilation, separate type checking from build

`mcp-use build` now uses esbuild for TypeScript transpilation instead of tsc. esbuild strips types without analyzing them, so it cannot OOM on complex type graphs (Zod v4, Prisma, etc.). Type checking runs separately via `tsc --noEmit` after transpilation — if it fails or OOMs, the build output is still produced. Use `--no-typecheck` to skip type checking entirely for faster builds.

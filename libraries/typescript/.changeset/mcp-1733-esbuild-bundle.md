---
"@mcp-use/cli": patch
---

fix(build): bundle each TypeScript entry with esbuild so extensionless relative imports resolve under plain Node ESM

`mcp-use build` now runs esbuild with `bundle: true` and `packages: "external"`. Relative imports between a user's source files are resolved at build time; third-party packages (`mcp-use`, `react`, `zod`, etc.) stay as external imports that Node resolves from `node_modules`. Users can keep writing idiomatic TypeScript imports without `.js` suffixes and `mcp-use start` no longer hits `ERR_MODULE_NOT_FOUND`.

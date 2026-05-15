---
"mcp-use": patch
---

Fix `TypeError: import_chalk.default.gray is not a function` crash when `mcp-use/server` is loaded from a CommonJS caller (MCP-2184).

Chalk v5 is ESM-only, so leaving it as an external dependency meant the published `.cjs` bundles emitted `require("chalk")` at runtime. Under Node's ESM-via-require interop, the resulting namespace had no usable `default`, and the first `chalk.gray(...)` call inside `server-lifecycle.ts`'s startup banner — fired from `@hono/node-server`'s `listening` event — threw immediately. This affected every CJS consumer of `mcp-use/server` since `1.27.0`, most visibly Next.js apps whose server runtime resolved through the `require` branch of the exports map.

Marks `chalk` as `noExternal` in `tsup.config.ts` so esbuild inlines chalk's source into mcp-use's bundles at build time. No more runtime `require("chalk")`, no interop bug. Mirrors the workaround `@mcp-use/cli` already uses for the same reason.

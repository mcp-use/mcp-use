---
"@mcp-use/cli": patch
---

fix(cli): keep `mcp-use build` non-fatal under the bun runtime

Building a project with `bun run build` inside an `oven/bun:alpine` image was failing in the tool-registry type-generation step. That step uses `tsx/esm/api`'s `tsImport`, which relies on Node.js custom loader hooks that bun does not implement, and the exception killed the whole build.

Three small changes keep the build moving:

- Detect the bun runtime up front in `generateToolRegistryTypesForServer` and skip the `tsx/esm/api` import with a clear warning instead of crashing.
- Wrap the build command's call to `generateToolRegistryTypesForServer` in try/catch so any other import-time error in the user's server file is surfaced as a non-blocking warning rather than exiting the build.
- Invoke `tsc --noEmit` via `process.execPath` instead of hardcoding `node`, so bun-only images (which don't ship a `node` binary) can still type-check. Also drop `--max-old-space-size=4096` under bun, which doesn't accept that flag.

Type generation remains available on Node.js. Under bun, users can still refresh `.mcp-use/tool-registry.d.ts` by running `mcp-use generate-types` from a Node.js shell when needed.

---
"create-mcp-use-app": patch
---

Switch template tsconfigs to `module: "NodeNext"` and `moduleResolution: "NodeNext"`.

Scaffolded apps run under native Node ESM (`mcp-use start` spawns plain `node`), but the previous `bundler` resolution let TypeScript accept extensionless relative imports that Node then rejected with `ERR_MODULE_NOT_FOUND`. NodeNext makes TypeScript enforce the `.js` suffix at authoring and at `tsc --noEmit` during `mcp-use build`, so the mismatch surfaces at compile time instead of at server start.

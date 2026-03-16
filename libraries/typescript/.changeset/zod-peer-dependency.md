---
"mcp-use": patch
---

fix: move zod from dependencies to peerDependencies to prevent duplicate type trees

When users had a different Zod v4 version than the bundled 4.3.5, npm/pnpm installed two copies. TypeScript then performed expensive structural comparisons of deeply recursive Zod types at every `server.tool()` and `ctx.elicit()` boundary, causing type errors or OOM during `mcp-use build`. Making Zod a peerDependency (`^4.0.0`) ensures a single shared instance.

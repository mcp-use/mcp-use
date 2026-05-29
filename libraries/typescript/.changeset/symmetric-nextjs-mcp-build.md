---
"@mcp-use/cli": patch
---

Build `--mcp-dir` servers into a deterministic `dist/mcp/index.mjs` artifact instead of recording the TypeScript source for production start. The scoped server build follows only the MCP entry dependency graph, replaces Next.js server-runtime imports with bundled inert shims, and prints warnings for each shimmed import.

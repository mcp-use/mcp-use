---
"@mcp-use/cli": patch
---

feat(build): run tool registry type generation during build

`mcp-use build` now generates `.mcp-use/tool-registry.d.ts` before TypeScript compilation when a server file exists. This fixes intermittent TS errors (e.g. `useCallTool` args typed as `null`) when `postinstall` typegen runs before source files are present (e.g. in Docker multi-stage builds). The `generate-types` command now uses the same shared helper.

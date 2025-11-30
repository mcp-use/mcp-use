---
"@mcp-use/inspector": patch
"mcp-use": patch
---

### Bug Fixes

- **Fixed bin entry issue (#536)**: Resolved pnpm installation warning where bin entry referenced non-existent `./node_modules/@mcp-use/cli/dist/index.js` path. Created proper bin forwarding script at `./dist/src/bin.js` that allows users to run `mcp-use` CLI commands (dev, build, etc.) after installing the package.

### Improvements

- Standardized import statement formatting across multiple files for improved code consistency and readability
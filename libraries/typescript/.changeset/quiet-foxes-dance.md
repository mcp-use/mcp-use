---
"@mcp-use/cli": patch
---

fix(cli): use build manifest entryPoint for start command and support multiple server output paths

**Build Command Improvements:**

- Find source server file before TypeScript compilation
- Determine compiled entry point location based on tsconfig patterns
- Write `entryPoint` to `dist/mcp-use.json` manifest for reliable server location
- Handle multiple possible output paths:
  - `dist/index.js` (rootDir set to project root)
  - `dist/src/index.js` (no rootDir, source in src/)
  - Custom paths based on tsconfig configuration

**Start Command Improvements:**

- Read `entryPoint` from `dist/mcp-use.json` manifest for accurate server location
- Fallback to checking common server file locations if manifest doesn't exist:
  - `dist/index.js`
  - `dist/server.js`
  - `dist/src/index.js`
  - `dist/src/server.js`
- Clear error message when no built server file is found, listing all attempted locations

Commits: 116a3be4 (partial)

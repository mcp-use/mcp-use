---
"@mcp-use/cli": patch
---

Fix displayPackageVersions() to work in standalone installations

- Added optional projectPath parameter to resolve packages dynamically
- Uses createRequire() to find packages in user's node_modules (standalone installation)
- Falls back to relative paths for monorepo development
- Added debug logging when packages aren't found (via DEBUG or VERBOSE env vars)

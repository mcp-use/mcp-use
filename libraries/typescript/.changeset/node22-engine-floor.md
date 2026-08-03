---
"mcp-use": patch
"create-mcp-use-app": patch
"@mcp-use/cli": patch
"@mcp-use/agent": patch
"@mcp-use/client": patch
"@mcp-use/inspector": patch
---

Raise the Node.js engine floor from `>=20.19.0` to `>=22.13.0` across published packages, scaffolds, examples, CI, Docker, and esbuild/tsup build targets. Use `@types/node` `^22.13.0`. Required for pnpm 11.13 in GitHub Actions and unblocks the beta release workflow.

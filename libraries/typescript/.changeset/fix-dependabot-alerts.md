---
"mcp-use": patch
"@mcp-use/inspector": patch
"@mcp-use/cli": patch
"create-mcp-use-app": patch
---

Fix Dependabot security alerts by updating vulnerable dependencies across the monorepo. Added pnpm overrides for flatted, tar, hono, @hono/node-server, express-rate-limit, dompurify, minimatch, rollup, form-data, lodash, and other transitive deps. Bumped direct deps: hono to ^4.12.7 (mcp-use, inspector), tar to ^7.5.11 (cli, create-mcp-use-app). Pinned @modelcontextprotocol/sdk to ^1.25.2 in proxy example.

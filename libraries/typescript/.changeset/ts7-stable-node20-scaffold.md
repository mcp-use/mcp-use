---
"mcp-use": patch
"create-mcp-use-app": patch
"@mcp-use/cli": patch
---

Refresh scaffold and example dependency pins: TypeScript `^7.0.2` (stable, replaces `7.0.1-rc`), React `^19.2.7`, and `@types/node` `^20.19.43`.

Unify the Node engine floor to `>=20.19.0` across published packages, templates, and examples (was `>=24.0.0` on `mcp-use`). Build output targets Node 20 to match. CI runs on Node 20.19.

New projects scaffolded with `create-mcp-use-app` include `"engines": { "node": ">=20.19.0" }` in `package.json`.

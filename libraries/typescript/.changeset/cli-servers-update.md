---
"@mcp-use/cli": minor
---

Add `servers update` subcommand to mutate server-level config after creation.

Previously there was no way to change `productionBranch` (or `buildCommand` / `startCommand` / `name`) on an existing server without deleting and recreating it — losing the URL slug and all env vars.

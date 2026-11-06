---
"@mcp-use/cli": patch
---

Add `mcp-use link` and `mcp-use unlink`. `link --server <id-or-slug>` checks that the server exists and that you can access it, then saves `{ orgId, serverId }` in `.manufact/project.json` and adds `.manufact/` to the project's `.gitignore`. Without a terminal, `link` needs `--server` (or `MANUFACT_SERVER`) and otherwise exits 2 with `project_not_linked`. `link` resolves the server from `--server`, then `MANUFACT_SERVER`, then the existing link, and the organization from `--org`, then `MANUFACT_ORG`, then the link, then the active organization. `deploy` now reads and writes the link in `.manufact/project.json`; a link in `.mcp-use/cloud/link.json` from an older CLI is moved there automatically.

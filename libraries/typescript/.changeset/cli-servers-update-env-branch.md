---
"@mcp-use/cli": minor
---

Add `servers update` and branch-scoped environment management to the CLI.

- `mcp-use servers update <id-or-slug>` mutates server config in place (production branch, name, description, build/start commands) without deleting and recreating the server — preserving the URL slug and env vars. `--branch` maps to the backend `productionBranch`; `--build-command`/`--start-command` are stored under the server `config`.
- `mcp-use deploy` gains `--branch <name>` (defaults to the current git branch) and scopes `--env`/`--env-file` sync to that branch's preview environment.
- `mcp-use servers env list/add/update/rm` gain `--branch <name>` for branch-scoped variables, and `update`/`rm` now accept a variable KEY (resolved within the branch scope) in addition to a UUID.
- `mcp-use deployments restart` gains `--branch <name>` (defaults to the deployment's branch).

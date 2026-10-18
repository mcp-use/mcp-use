---
"@mcp-use/cli": patch
---

fix(cli): `mcp-use deploy --env` on a linked server now scopes variables to the deployment it starts: production when the deployed branch is the production branch (including after `--branch` sets it), otherwise a preview override for that branch. Before, `--branch main --env K=V` saved K as a preview variable that the production deploy never applied, and deploying a feature branch wrote K to production.

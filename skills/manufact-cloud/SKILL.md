---
name: manufact-cloud
description: Deploy and manage MCP servers on Manufact Cloud with the mcp-use CLI, including authentication, projects, environments, deployments, domains, organizations, publishing checks, and YAML alerts.
---

# Manufact Cloud CLI

Use the installed `mcp-use` CLI. Cloud commands work with any MCP framework.
Check `mcp-use <command> --help` before using unfamiliar flags; this skill ships
with the CLI version whose commands it describes.

## Agent workflow

- Pass `--json` when consuming output. A command writes one JSON value to
  stdout, including errors. Exit 0 means success, 1 operational failure, and
  2 invalid or missing input. Errors contain `error.code`, `error.message`,
  and `error.nextSteps` with commands to resolve the problem.
- In CI, provide `MANUFACT_TOKEN` through the secret store. `MCP_USE_API_KEY`
  is the fallback. Check identity with `mcp-use whoami --json`.
- Without a terminal, `mcp-use login --json` returns a device code and exits.
  Present the verification URL and user code, then run the returned
  `login --device-code <code>` command after approval. An onboarding prompt
  may already include an approved device code.
- Resolve project context before changing a server. `link --server <id-or-slug>`
  saves `.manufact/project.json`. Server selection is `--server`,
  `MANUFACT_SERVER`, then that link. Organization selection is `--org`,
  `MANUFACT_ORG`, the link, the saved active organization, then the account
  default. Use `org use <id-or-slug>` to change the active organization.
- `deploy` waits for completion by default. With `--no-wait`, retain the
  returned deployment ID and inspect `deployments get <id> --json` later.
  Use `logs <id> --build` to diagnose a failed build or start.
- Use the returned `dashboardUrl` when a human needs the dashboard. Keep
  credentials and environment variable values out of chat, logs, and commits.

## Choose a command

- **Deploy or redeploy:** read [deployment workflows](references/deployments.md).
- **Environment variables and configuration:** read
  [server management](references/management.md).
- **Domains, GitHub, organizations, and publishing checks:** read
  [other Cloud commands](references/cloud-commands.md).
- **Create or update alerts:** read [alert rules](references/alerts.md) for the
  dashboard YAML format, metric selection, and useful recovery conditions.

`rm` is the destructive verb, with `remove` as an alias. Confirm the target
organization and server from the user's request before running destructive
commands. Use existing authorization when the user already requested the change.

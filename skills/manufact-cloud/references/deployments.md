# Deployment workflows

## GitHub

Run from the repository or pass its path:

```bash
mcp-use github installations --json
mcp-use github repos --json
mcp-use deploy --name weather --json
```

The GitHub App must have access to the repository and the chosen branch must
be pushed. `github connect` returns the installation URL. For a monorepo, use
`--root-dir`. Override the branch with `--branch` and build/start settings with
`--build-command`, `--start-command`, `--dockerfile`, or `--region`.

A project link is stored under `.manufact/`, separate from local build output.
Subsequent deploys reuse the link; `--new` creates another server.
An unlinked deploy creates a server and saves its link automatically; a separate
`link` step is not required. Declining a Git commit/push prompt continues the
deployment using the pushed remote branch, without including unpushed changes.

## Local source

```bash
mcp-use deploy . --no-github --name weather --json
```

Upload source that includes the files required to build and run the server.
Cloud deployment does not require an mcp-use package or a prebuilt `.mcp-use/`
directory. Supply commands appropriate to the project's framework.

## An already-hosted server

```bash
mcp-use deploy --external-url https://example.com/mcp --name weather --json
```

The endpoint must use HTTPS. External registration rejects source/build/env
options. This registers an existing MCP endpoint. It does not upload source or build
an application.

## Environment and progress

Repeat `--env KEY=VALUE` or use `--env-file <file>`. Deploy-time variables target
production when deploying the server's production branch; other branches get a
branch-specific preview override. Keep secret values in files or stdin rather
than shell history where possible; see the environment commands reference.

`deploy` waits by default. `--no-wait` returns as soon as a deployment is created.
Inspect the deployment status and logs by its ID:

```bash
mcp-use deployments get DEPLOYMENT_ID --json
mcp-use logs DEPLOYMENT_ID --build --json
mcp-use logs DEPLOYMENT_ID --follow
```

For human review, omit `--json`. The deploy receipt includes elapsed command
time, source branch/commit, MCP URL and IDs when available. Deployment lists
show build duration and production traffic; absence of production traffic does
not establish that a deployment is a preview. Keep full IDs for later commands.

A timeout during creation or start can leave the outcome uncertain. Inspect any
returned server/deployment ID before retrying instead of assuming the operation
did not take effect.

`deployments restart` starts a replacement, `promote` promotes a deployment,
`stop` stops it, and `rm` removes it. Read each command's help for required
arguments and confirmation flags. Retain IDs returned by mutations rather
than guessing resource names.

When Git setup or synchronization is needed, `deploy --yes` authorizes the
necessary Git initialization, commits, and pushes. Use it only when the user
has requested those repository changes.

Runtime `logs --follow` continues until interrupted. Build following ends at a
terminal deployment status. With `--json`, the command emits its result when
following ends. Deployment promotion/stopping/removal requires `--yes` in a
non-interactive command.

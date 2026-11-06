# `@mcp-use/cli`

Prebuilt CLI, development server, build pipeline, and MCP client for
[mcp-use](https://github.com/mcp-use/mcp-use).

```bash
npx mcp-use dev
npx mcp-use client connect demo https://example.com/mcp
npx mcp-use client demo tools list
```

## Commands

```text
mcp-use <command> [options]

  dev          Start the dev server
  build        Build the server into .mcp-use/build
  typecheck    Refresh MCP types and run the project's TypeScript compiler
  start        Serve the production build from .mcp-use/build
  client       Connect to and invoke MCP servers
  feedback     Send CLI feedback to Manufact
  screenshot   Capture an MCP Apps view
  deploy       Deploy from GitHub or upload local source
  login/logout/whoami/org/servers/deployments
               Manage Manufact Cloud sessions, servers, and deployments
```

`mcp-use dev` serves the MCP endpoint, watches views for HMR, and mounts the
Inspector. `--tunnel` exposes either `dev` or `start` through the managed
relay in [`@mcp-use/tunnel`](https://www.npmjs.com/package/@mcp-use/tunnel).

Run `mcp-use --help` for the full option list.

## Send CLI feedback

```bash
mcp-use feedback send "Deploy output should include the server URL."
mcp-use feedback send "The env push error needs a recovery command." --json
```

Pass one quoted message (1–10,000 characters). No login is required. Use
`--json` for a machine-readable receipt.

Reports are explicit submissions to the SDK's PostHog project, even with
passive analytics disabled. Only the supplied message, report ID, anonymous
installation ID, and the basic CLI metadata described below
are sent. No logs, project files, credentials, or conversations are collected.
Review report text before sending and omit secrets or personal data. If identity
storage is unavailable, the report uses a temporary random ID.

The request has a 10-second timeout and no automatic retries. Exit 0 means the
capture endpoint accepted the request, not that someone has reviewed it or that
downstream ingestion has completed. `--json` returns `{ "accepted": true,
"reportId": "<uuid>" }`. Exit 1 returns `feedback_rejected`,
`feedback_network_error`, or `feedback_timeout`; timeout/network errors leave
acceptance unknown. Invalid input exits 2 with `usage_error`.

## Anonymous usage analytics

The CLI sends a `mcp_use_cli_command` event to the same PostHog project used
by the SDK. It records the command and known subcommand, CLI version, OS,
architecture, Node version, and whether it runs in CI or an interactive
terminal. Help requests have `is_help: true` so they can be excluded from
command rankings. Events count invocations, including failed attempts.

A random installation ID is saved in `~/.mcp-use/cli-telemetry.json` and
reused across projects and CLI upgrades. Unique IDs measure installations,
not people; disposable CI homes create new IDs, so filter `is_ci: false`
when measuring developer adoption. No argument values, paths, server/tool
names, environment variable contents, credentials, or account details are
sent in usage events. Explicit feedback is separate and includes the report
text you supply. Capture is best effort, with a 500 ms network timeout and no retries.
If the ID cannot be persisted, capture is skipped.

Set `MCP_USE_ANONYMIZED_TELEMETRY=false` or `DO_NOT_TRACK=1` in your shell
to disable CLI analytics. Tests (`NODE_ENV=test`) also disable capture.

In PostHog, use unique users of `mcp_use_cli_command` for daily/weekly active
installations. Use total events broken down by `command` and `subcommand`
for command rankings, excluding `is_help: true`.

## Documentation

The exhaustive command reference, including every flag and the CLI environment
variables, lives at
[CLI Reference](https://docs.mcp-use.com/v2/typescript/api-reference/cli-reference).
New to the framework? Start with the
[quickstart](https://docs.mcp-use.com/v2/typescript/getting-started/quickstart).

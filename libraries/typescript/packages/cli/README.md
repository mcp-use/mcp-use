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
  screenshot   Capture an MCP Apps view
  deploy       Deploy from GitHub or upload local source
  login/logout/whoami/org/servers/deployments
               Manage Manufact Cloud sessions, servers, and deployments
```

`mcp-use dev` serves the MCP endpoint, watches views for HMR, and mounts the
Inspector. `--tunnel` exposes either `dev` or `start` through the managed
relay in [`@mcp-use/tunnel`](https://www.npmjs.com/package/@mcp-use/tunnel).

Run `mcp-use --help` for the full option list.

## Documentation

The exhaustive command reference, including every flag and the CLI environment
variables, lives at
[CLI Reference](https://docs.mcp-use.com/v2/typescript/api-reference/cli-reference).
New to the framework? Start with the
[quickstart](https://docs.mcp-use.com/v2/typescript/getting-started/quickstart).

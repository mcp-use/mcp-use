# Dreamtune MCP client

Connect `@mcp-use/client` to [Dreamtune](https://dreamtunelabs.com) for model requests, tool runs, GPU compute and run inspection. This example uses the published stdio server without an LLM, so no separate model provider API key is required.

## Setup

Follow the repository's TypeScript development setup with Node.js **22.22.2+** and the pinned pnpm version. From `libraries/typescript`, install dependencies and build the client:

```sh
pnpm install --frozen-lockfile
pnpm --filter @mcp-use/client build
cd packages/client
export DREAMTUNE_API_KEY="YOUR_DREAMTUNE_WORKSPACE_KEY"
node examples/node/dreamtune.ts
```

On PowerShell, use `$env:DREAMTUNE_API_KEY = "YOUR_DREAMTUNE_WORKSPACE_KEY"` instead of `export`.

The example reads the workspace key from the environment, pins `@dreamtune/sdk@0.1.2`, and explicitly sets the production API origin and request timeout. Keep real keys out of source and Git.

## Discover and invoke

The default run connects, lists tool names and descriptions, and closes the client in `finally`. It does not start model inference, paid tool runs or compute jobs.

Use a name from discovery and the arguments in the [MCP tool reference](https://docs.dreamtunelabs.com/reference/mcp-tools) for an explicit call:

```sh
node examples/node/dreamtune.ts --tool compute_catalog --arguments '{}'
```

Results are printed as JSON. The script rejects non-object JSON and unknown tool names, and MCP tool errors return a nonzero exit status.

Calls use the key's workspace and scopes. Model requests, paid tool runs and compute jobs can incur charges, and compute may continue billing until stopped. Only `--tool` triggers an invocation in this example. For operations requiring an idempotency key, persist it before submission and reuse it only for identical intended work.

See [local MCP setup](https://docs.dreamtunelabs.com/connect/local-mcp) for optional GPU access and [hosted MCP setup](https://docs.dreamtunelabs.com/connect/mcp) for Streamable HTTP configuration.

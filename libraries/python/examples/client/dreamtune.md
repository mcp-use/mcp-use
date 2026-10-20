# Dreamtune MCP client

Connect `MCPClient` to [Dreamtune](https://dreamtunelabs.com) for model requests, tool runs, GPU compute and run inspection. This example uses the published stdio server without an LLM, so no separate model provider API key is required.

## Setup

Follow the [Python development setup](../../../../CONTRIBUTING.md#python-development) and activate the library's virtual environment. Install Node.js **22.20+** with `npx` on your PATH. From `libraries/python`:

```sh
export DREAMTUNE_API_KEY="YOUR_DREAMTUNE_WORKSPACE_KEY"
python examples/client/dreamtune.py
```

On PowerShell, set `$env:DREAMTUNE_API_KEY = "YOUR_DREAMTUNE_WORKSPACE_KEY"` instead of `export`.

The example reads the key from the environment, pins `@dreamtune/sdk@0.1.2`, and explicitly configures the production API origin and request timeout. Keep real keys out of source files and Git.

## Discover and invoke

The default run initializes the server, lists tool names and descriptions, and closes the session in `finally`. It does not start model inference, paid tool runs or compute jobs.

To invoke a tool explicitly, use its name from discovery and arguments from the [MCP tool reference](https://docs.dreamtunelabs.com/reference/mcp-tools):

```sh
python examples/client/dreamtune.py --tool compute_catalog --arguments '{}'
```

Results are printed as JSON; MCP tool errors return a nonzero exit status. The same `mcpServers.dreamtune` configuration can also be passed to `MCPClient` used by your `MCPAgent`.

Calls use the key's scopes and workspace. Model requests, paid tool runs and compute jobs can incur charges, and compute may continue billing until stopped. Only `--tool` triggers a tool invocation in this example. For operations that require an idempotency key, persist it before submission and reuse it only for identical intended work.

See [local MCP setup](https://docs.dreamtunelabs.com/connect/local-mcp) for optional GPU access and [hosted MCP setup](https://docs.dreamtunelabs.com/connect/mcp) for Streamable HTTP configuration.

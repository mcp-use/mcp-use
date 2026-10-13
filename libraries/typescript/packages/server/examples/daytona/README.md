# Daytona code execution

A minimal `mcp-use` server with one tool, `run_code`. Each call creates a
[Daytona sandbox](https://www.daytona.io/docs/en/typescript-sdk/), runs Python,
TypeScript, or JavaScript, and deletes the sandbox in `finally`.

## Run

From `libraries/typescript`:

```sh
pnpm --filter mcp-use-example-daytona install
cd packages/server/examples/daytona
cp .env.example .env
```

Add a [Daytona API key](https://app.daytona.io/) to `.env`, then run:

```sh
pnpm dev
```

Open the Inspector URL printed by the CLI and call `run_code`:

```json
{
  "language": "python",
  "code": "print(sum([1, 2, 3]))",
  "timeoutSeconds": 30
}
```

The result contains `output` and `exitCode`. For TypeScript or JavaScript, use
`"code": "console.log(1 + 2 + 3)"` and the matching `language`.
The server starts without a key so the Inspector can load; tool execution
returns a configuration error until you set the key and restart.

Execution defaults to 30 seconds, capped at 120. Sandbox creation has a separate
60-second timeout and deletion has a 30-second timeout. Nonzero exit codes,
provider failures, and cleanup failures return MCP tool errors. A cleanup
failure preserves any execution output and includes the sandbox ID so you can
check it in Daytona. Auto-stop after five idle minutes and deletion on stop
provide a fallback if the server exits before cleanup. Sandbox calls consume
your Daytona account's resources. Keep this development server local.

This uses the current `@daytona/sdk` package; `@daytonaio/sdk` is deprecated.
`pnpm typecheck` checks the SDK integration; `pnpm verify` checks example
configuration without requiring credentials; `pnpm build` bundles the server. Live execution requires
a valid Daytona key and available sandbox quota.

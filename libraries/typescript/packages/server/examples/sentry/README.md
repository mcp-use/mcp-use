# Sentry tool monitoring

Trace mcp-use tool callbacks and report both returned tool errors and exceptions using existing MCP middleware. No SDK changes or additional application services are required.

## Run

From this directory:

```bash
cp .env.example .env
# Set MCP_USE_SENTRY_DSN to your Sentry project DSN.
pnpm dev
```

In Inspector, call `monitored_report` with `outcome` set to `success`, `tool_error`, or `exception`. Look for `tools/call monitored_report` in Sentry Traces and the failures in Issues. Without a DSN, tools still work but no telemetry is sent.

The example initializes Sentry once with automatic integrations disabled and every trace sampled. Arguments and returned content are not recorded. Exception messages and stacks are captured. Reuse an existing Sentry initialization when adapting this middleware, and check for duplicate capture from other instrumentation.

This monitors registered tool callbacks, not transport failures or validation rejected before callback dispatch. It targets a long-running Node process; serverless runtimes need lifecycle-aware flushing.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

Tests invoke the server over MCP and use real Sentry spans and error processing with a local transport. No Sentry account or network access is needed for the tests.

`pnpm verify` runs the registered example's type and configuration checks without contacting Sentry. Live provider verification is deferred; use the Inspector steps above with your DSN to check telemetry delivery.

## Standalone demo

The [standalone repository](https://github.com/manufacts/mcp-use-sentry-example) runs with published mcp-use dependencies. [Try the hosted tools demo](https://inspector.manufact.com/inspector?embedded=true&autoConnect=https%3A%2F%2Fmanufact-sentry-example.run.mcp-use.com%2Fmcp&embeddedConfig=%7B%22singleTab%22%3Atrue%2C%22defaultTab%22%3A%22tools%22%2C%22visibleTabs%22%3A%5B%22tools%22%5D%7D). Hosted calls send telemetry to Manufact’s demo Sentry project; use your own DSN to inspect events in your account.

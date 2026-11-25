# MCP Events on Manufact Cloud

mcp-use servers deployed to Manufact Cloud run MCP Events with no
configuration.

## Platform binding

The platform injects `MCP_USE_PLATFORM_STORAGE_URL`, `_STORAGE_TOKEN`,
`_STORAGE_PREFIX`, `_NAMESPACE` and `_SECRET` as one unit. Do not set them
yourself. If the user sets `MCP_USE_STORAGE_URL`, their store wins and the
platform keeps one instance warm instead. `EVENTS_PLATFORM_BINDING_INCOMPLETE`
in logs means a partial set leaked in: remove the stray variables.

## Previews and namespaces

Each environment and preview branch has its own namespace (for example
`srv_8f:production`, `srv_8f:preview-feat-x`). Subscriptions, logs and dead
letters never cross namespaces. Rollbacks keep the namespace, so
subscriptions survive.

## Wake guarantee

Sleeping deployments are woken when deliveries or retries are due, and a poll
wakes a sleeping container. No cron is needed.

## Commands

```bash
npx mcp-use events status [--server ID] [--env production] [--json]
npx mcp-use events catalog
npx mcp-use events subscriptions [--name note.created] [--principal P]
npx mcp-use events deliveries [--failed]
npx mcp-use events redeliver DEAD_LETTER_ID
npx mcp-use events revoke --principal P | --subscription SUB_ID
npx mcp-use events emit note.created '{"folder":"inbox","noteId":"n1","title":"Test"}'
npx mcp-use events purge --confirm NAMESPACE
```

- `emit` sends a test event (ids get a `test_` prefix) and asks for
  confirmation outside dev.
- `revoke` ends webhook subscriptions, polls and streams for the target.
- `purge` deletes the namespace; it is irreversible.

## Branch semantics and decommission

Deleting a branch or environment decommissions its namespace: every
subscription is revoked, `onUnsubscribe(…, "closed")` runs, SEP subscribers
receive `terminated`, then the namespace is purged.

## Troubleshoot

- No deliveries: `events status` for `due`, `deadLetters` and
  `circuitOpenHosts`, then `events deliveries --failed`.
- ChatGPT shows no events: the user must press **Refresh tools** after a
  deploy that changed the catalog.
- Docs: `/typescript/server/deployment/mcp-use` (Events on Manufact Cloud).

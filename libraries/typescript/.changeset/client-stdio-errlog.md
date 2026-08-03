---
"@mcp-use/client": patch
---

Make the stdio `errlog` option work, and expose `stderr` as a supported mode.

The transport was spawned without `stderr: "pipe"`, so the SDK defaulted to `"inherit"`, `transport.stderr` was null, and the block that forwards the child's stderr to `errlog` never ran. `errlog` now receives the child's stderr by default:

```ts
new StdioConnector({ command, args, errlog });
```

`stderr` is accepted on `StdioConnector` and `StdioServerConfig` and forwarded to the transport, so the previous behaviour is still available explicitly:

```ts
new StdioConnector({ command, args, stderr: "inherit" });
```

**Behaviour change:** stdio children previously inherited the parent's stderr file descriptor and now get a pipe by default. Output still reaches `process.stderr` when no `errlog` is given, but a child that checks whether stderr is a TTY will no longer see one, which can disable its colorized output. Pass `stderr: "inherit"` to restore that, or `"ignore"` to discard child stderr entirely.

Forwarding also pipes with `{ end: false }` and unpipes on close, so a caller-owned `errlog` is not closed when a child exits and can be reused across reconnects or several connectors.

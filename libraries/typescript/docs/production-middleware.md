# Production Middleware

`mcp-use/server` exports small dependency-free helpers for production MCP
semantics. They compose through the existing `server.use("mcp:...", ...)`
operation middleware.

```ts
import {
  createAuditLogMiddleware,
  createIdempotencyKeyMiddleware,
  createTimeoutPolicyMiddleware,
} from "mcp-use/server";

server.use(
  "mcp:tools/call",
  createTimeoutPolicyMiddleware({ timeoutMs: 10_000 })
);

server.use(
  "mcp:tools/call",
  createIdempotencyKeyMiddleware({
    mutatingTools: ["create_order", "delete_order"],
  })
);

server.use(
  "mcp:*",
  createAuditLogMiddleware({
    onEvent: (event) => console.log(JSON.stringify(event)),
  })
);
```

## Timeout Policy

`createTimeoutPolicyMiddleware()` races the operation against a timer. It also
stores an `AbortSignal` on `ctx.state` under `abortSignal` so cooperative
handlers can stop their own work early.

This is intentionally not a process killer. JavaScript cannot safely terminate
arbitrary user code without moving work into another runtime.

## Idempotency Keys

`createIdempotencyKeyMiddleware()` extracts keys from `params._meta`, request
`_meta`, or tool arguments using common names like `idempotencyKey`,
`idempotency_key`, and `Idempotency-Key`.

Matched mutating tools require a key by default:

```ts
server.use(
  "mcp:tools/call",
  createIdempotencyKeyMiddleware({
    mutatingTools: /^delete_|^update_/,
  })
);
```

The helper only validates and exposes the key on `ctx.state.idempotencyKey`. It
does not cache, replay, or deduplicate results; applications should use the key
with their own database or API idempotency support.

## Audit Events

`createAuditLogMiddleware()` emits one event after each MCP operation with
method, tool/resource/prompt identifier, session, subject, scopes, idempotency
key, duration, success, and error details. Audit hook failures are swallowed by
default so a logging outage does not break tool calls.

## Security Doctor Data

`lintMcpSecurity()` accepts plain server metadata and returns a
`SecurityDoctorReport` with stable finding IDs, severity, summary counts, and
recommendations. It is a data model for CLI/CI doctor output, not runtime
enforcement.

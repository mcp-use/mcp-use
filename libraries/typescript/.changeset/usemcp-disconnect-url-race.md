---
"mcp-use": patch
---

fix(react): prevent stale disconnect from clearing a reconnected MCP client

When `useMcp` reconnects after a URL change (e.g. dashboard environment
switch), the previous effect's async `disconnect()` could finish after the
new `connect()` and set `clientRef` to null while React state remained
`ready`, causing tool calls to fail with a misleading "not ready (current
state: ready)" error.

`disconnect()` now only nulls `clientRef` if it still points at the client
being closed. MCP operation errors distinguish a missing client from a
non-ready state.

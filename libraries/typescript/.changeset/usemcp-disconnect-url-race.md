---
"mcp-use": patch
---

fix(react,client): prevent stale disconnect from wiping a reconnected MCP session

When `useMcp` reconnects after a URL change (e.g. dashboard environment
switch), the previous effect's async `disconnect()` could finish after the
new `connect()` and either:

1. set `clientRef` to null while React state remained `ready` — surfacing
   as "MCP client is not ready (current state: ready)"; or
2. wipe the freshly-created session out of the underlying client's session
   map — surfacing as "No active session found" on the next tool call.

`disconnect()` now only nulls `clientRef` **and** resets the hook state when
it has not been superseded by a newer `connect()` (a `connectEpochRef` counter
bumped at the start of each `connect()`, plus a client-identity check). This
covers both the case where `connect()` reuses the same `BrowserMCPClient`
instance for the new URL and a manual `disconnect()` racing a reconnect, which
must not clobber the live connection's state back to `discovering`.

`BaseMCPClient.closeSession()` now only deletes `sessions[name]` if the slot
still references the captured session. A parallel `createSession()` from a
newer `connect()` may have already written a new session there while we were
awaiting `session.disconnect()`; the previous unconditional `delete` in the
`finally` block would wipe that new session and break tool calls.

MCP operation errors also distinguish a missing client from a non-ready
state.

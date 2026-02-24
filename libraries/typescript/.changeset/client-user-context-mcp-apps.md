---
"mcp-use": minor
"@mcp-use/inspector": minor
"@mcp-use/cli": patch
---

feat: ctx.client.user(), MCP Apps capabilities fix, CLI tunnel inspector fix

### mcp-use

**ctx.client.user()** — new per-invocation method on the tool context that extracts
end-user metadata from `tools/call` `params._meta` (e.g. ChatGPT `openai/*` keys).
Returns `undefined` on clients that don't send request-level metadata. The `UserContext`
type is exported from `mcp-use/server`.

ChatGPT runs a single MCP session for all users of a deployed app — use
`ctx.client.user()?.subject` to identify the user and `?.conversationId` for the thread.

**MCP Apps capabilities fix** — patched the MCP SDK's `ClientCapabilitiesSchema` to
preserve the `extensions` field (previously stripped by Zod's default `$strip` mode),
so `ctx.client.supportsApps()` now correctly returns `true` for clients that advertise
`io.modelcontextprotocol/ui`.

**Session isolation fix** — `findSessionContext` no longer falls back to an arbitrary
session when the correct one can't be matched, preventing metadata leakage in
multi-connection scenarios.

### @mcp-use/inspector

The Inspector now advertises MCP Apps support (`io.modelcontextprotocol/ui`) in its
`clientInfo.capabilities`. The `capabilities` field on `McpClientProvider.clientInfo`
is a new provider-level default that applies to all server connections, including those
restored from localStorage.

### @mcp-use/cli

Fixed: the Inspector's `?autoConnect=` URL now uses the tunnel endpoint when
`--tunnel` is active, instead of always pointing to `localhost`.

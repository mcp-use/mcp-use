---
"mcp-use": patch
---

Fix `McpClientProvider.removeServer` and `McpClientProvider.updateServer` triggering React's "Cannot update a component (`McpServerWrapper`) while rendering a different component (`McpClientProvider`)" warning whenever a wrapper is torn down.

Both methods invoked `server.disconnect()` and `server.clearStorage()` *inside* a `setServers((prev) => …)` updater. React 18+ runs updater functions during the render phase of the component that owns the state, and both wrapper callbacks make synchronous setState calls on the wrapper itself — `setLog` via `addLog("info", "Disconnecting…")` (the very first sync line of `disconnect`) and `setAuthUrl(void 0)` inside `clearStorage`. Those setStates landed during `McpClientProvider`'s render phase, producing the warning every time a consumer changed the URL of an existing wrapper or removed one.

The provider now keeps a `serversRef` mirror of `servers`, captures the wrapper to tear down BEFORE scheduling the state updates, and runs `disconnect()` / `clearStorage()` after the `setServers` / `setServerConfigs` calls return. The updaters are now pure (`(prev) => prev.filter(…)`); the wrapper's synchronous setStates fire from event-handler context and batch normally with the pending provider updates, never crossing into the render phase.

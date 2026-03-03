---
"mcp-use": patch
---

Fix unwanted GET polling when autoReconnect is disabled and spurious duplicate server warning in StrictMode

- When `autoReconnect: false` is set, the SDK transport's internal SSE reconnection is now also disabled (`maxRetries: 0`), preventing recurring GET requests every ~2 seconds to streamable HTTP servers.
- `getServer()` now checks `serverConfigs` in addition to the reactive `servers` state, so a `!getServer(id)` guard works correctly in React StrictMode double-mount scenarios. The duplicate `addServer` log has been downgraded to debug level.

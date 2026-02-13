---
"mcp-use": patch
---

fix: propagate widget resources and resource templates to existing MCP sessions during HMR

Widget resources added via the file watcher (e.g. creating a new file in `resources/`) were registered in the server wrapper but never pushed to already-connected sessions. This caused "Resource ui://widget/... not found" errors when tools referencing those widgets were executed without reconnecting.

- Added `propagateWidgetResourcesToSessions()` to push newly registered widget resources and templates to all active sessions independently of tool registration
- Fixed resource template lookup key mismatch in `addWidgetTool` and `propagateWidgetResourcesToSessions` — templates are stored by name only, not `name:uri`
- Track propagated resources in `sessionRegisteredRefs` so `syncPrimitive` preserves them across subsequent HMR cycles

---
"mcp-use": patch
---

Fix `errlog` being a silent no-op on stdio connections: `StdioConnectionManager` now spawns the child with `stderr: "pipe"` (unless an explicit stderr mode is set in server params), so the child's stderr is actually forwarded to the configured `errlog` stream instead of always inheriting the parent's stderr. Fixes #1899.

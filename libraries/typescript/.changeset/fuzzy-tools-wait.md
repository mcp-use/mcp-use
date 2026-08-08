---
"mcp-use": patch
"@mcp-use/cli": patch
---

Make `mcp-use dev` reconcile server and V2 view changes as coherent project generations. Reload candidates now use immutable view snapshots, and stale candidates cannot replace the active handler, publish catalog changes, or report superseded failures.

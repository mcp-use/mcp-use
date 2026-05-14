---
"mcp-use": patch
"@mcp-use/inspector": patch
"@mcp-use/cli": patch
"create-mcp-use-app": patch
---

Prune unused exports flagged by Knip. Removes 187 unused exports and deletes 19 unused source files across packages. No public API changes — only internal helpers and barrel re-exports that no consumer was using were touched.

---
"mcp-use": patch
"@mcp-use/cli": patch
---

Allow tool-only servers to build and run without a views directory or React
view component.

`mcp-use build` and `mcp-use dev` now prime and validate an empty view registry,
log when the views directory is not configured, and preserve the precise
view-binding error when a tool references a view that does not exist.

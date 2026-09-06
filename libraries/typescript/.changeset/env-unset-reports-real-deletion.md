---
"@mcp-use/cli": patch
---

`servers env unset` now reports whether a variable was actually deleted. It prints `Deleted <key>.` only when a matching variable existed and `<key> does not exist.` otherwise, naming the branch when `--branch` is supplied. The `--json` result carries a boolean `deleted` field instead of echoing the key back, so scripts can distinguish a real deletion from a no-op.

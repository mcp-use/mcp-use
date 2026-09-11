---
"@mcp-use/cli": patch
---

Reject an inline value on boolean CLI switches instead of silently discarding it. `mcp-use dev --tunnel=false` previously parsed as `--tunnel` and opened a public tunnel; it now fails with `--tunnel does not take a value`. The same applies to `--no-open`, `--no-inspector`, `--with-inspector`, `--source-maps`, `--inline`, `--help`, and `--version`. Flags that take a value continue to accept both `--flag value` and `--flag=value`.

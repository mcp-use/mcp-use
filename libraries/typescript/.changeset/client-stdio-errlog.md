---
"@mcp-use/client": patch
---

Make the stdio `errlog` option work. The transport was spawned without `stderr: "pipe"`, so the SDK defaulted to `"inherit"`, `transport.stderr` was null, and the block that forwards the child's stderr to `errlog` never ran. An explicit `stderr` mode in server params still takes precedence.

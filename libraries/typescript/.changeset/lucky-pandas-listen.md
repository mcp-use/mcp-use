---
"@mcp-use/cli": minor
---

Reject an empty value on CLI flags that take one, instead of accepting it. `mcp-use dev --host=` previously resolved to an empty bind address, which Node binds as `::` (every interface) rather than the documented `127.0.0.1` default, and `mcp-use start --port=` became `Number("") === 0`, an ephemeral port. Both now fail with `Missing value for --host` / `Missing value for --port`. This matches `resolveListenPort`, which already treats a blank `PORT` environment variable as absent.

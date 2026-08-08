---
"@mcp-use/client": patch
---

Fix code mode with a custom executor function: the first `executeCode()` call no longer throws `Custom executor function should be handled in executeCode`, `searchTools()` works instead of always throwing, and `close()` runs executor cleanup. Also forward `detail_level` from the `search_tools` meta tool instead of silently coercing every value to `"full"`.

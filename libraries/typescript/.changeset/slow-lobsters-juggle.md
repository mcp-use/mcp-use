---
"@mcp-use/inspector": patch
---

Replace stale saved auto-connect entries when the advertised transport changes, so embedded Inspector instances do not keep retrying deprecated SSE connections after switching to streamable HTTP.

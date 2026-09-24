---
"@mcp-use/cli": patch
---

Return a 500 JSON error when the dev inspector's `stop-tunnel` route fails, matching `start-tunnel`. A rejection from `TunnelManager.stop()` previously escaped the dev API handler, so the Inspector received a generic internal error instead of `{ error: "<reason>" }` and the reason was not logged anywhere.

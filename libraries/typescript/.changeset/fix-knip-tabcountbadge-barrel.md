---
"@mcp-use/inspector": patch
---

Drop unused `TabCountBadge` re-export from the shared barrel; the only consumer imports it directly. Fixes Knip CI on canary.

---
"@mcp-use/inspector": patch
---

fix(inspector): OAuth BFF metadata responses are always JSON with `nosniff`, so a caller-chosen upstream body can no longer render as a page on the Inspector origin; proxy and OAuth rate limits are per caller (client IP) under a process-wide ceiling instead of one shared bucket

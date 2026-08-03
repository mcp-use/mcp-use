---
"mcp-use": patch
"@mcp-use/inspector": patch
---

Resolve the current Inspector beta once per page load, then load the entry script, stylesheet, and lazy chunks from the same immutable release. This prevents mixed-version CDN 404s while keeping embedded inspectors on the latest beta.

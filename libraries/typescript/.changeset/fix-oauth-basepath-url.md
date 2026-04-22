---
"mcp-use": patch
---

Fix OAuth authorize redirect stripping URL path when auth server uses basePath. The `authenticate()` function now preserves the pathname component (e.g. `/api/auth`) instead of reducing the URL to just the origin.

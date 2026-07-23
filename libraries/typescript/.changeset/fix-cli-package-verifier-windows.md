---
"@mcp-use/cli": patch
---

Fix CLI package verification on Windows by converting the package file URL to a native path before scanning `dist`.

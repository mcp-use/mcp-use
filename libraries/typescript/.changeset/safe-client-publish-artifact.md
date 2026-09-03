---
"@mcp-use/client": patch
"@mcp-use/inspector": patch
---

Prevent concurrent package publishing from removing the Client build while its tarball is being created, and verify every published artifact contains its declared files and entry points.

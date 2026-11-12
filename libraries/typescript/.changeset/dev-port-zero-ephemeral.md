---
"@mcp-use/cli": patch
---

`mcp-use dev --port 0` (or `PORT=0`) now binds an OS-assigned port and prints, exports, and opens that port instead of `http://localhost:0`.

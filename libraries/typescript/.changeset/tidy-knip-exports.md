---
"mcp-use": patch
"@mcp-use/agent": patch
"@mcp-use/client": patch
"@mcp-use/inspector": patch
"create-mcp-use-app": patch
---

chore: clear unused TypeScript export surface flagged by knip

Trim internal barrels, drop dead stubs and duplicate re-exports, and un-export file-local helpers so knip reports a clean export graph without changing published package entry APIs.

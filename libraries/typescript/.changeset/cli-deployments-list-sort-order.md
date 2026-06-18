---
"@mcp-use/cli": patch
---

`mcp-use deployments list` now preserves the deployment ordering returned by the API instead of re-sorting by creation date on the client. This keeps the displayed order consistent with the server's pagination and sort.

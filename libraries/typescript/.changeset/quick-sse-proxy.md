---
"@mcp-use/inspector": patch
"@mcp-use/client": patch
"@mcp-use/cli": patch
---

Disable reverse-proxy buffering for open-ended MCP SSE responses so v2 subscription acknowledgements reach clients immediately, and move optional mixed-auth discovery off the connection readiness path while preserving asynchronous React updates and CLI reporting.

---
"@mcp-use/inspector": patch
---

Fix custom headers not being included when copying connection configuration from saved connection tiles. Headers are now correctly read from localStorage where they are stored in proxyConfig.customHeaders.


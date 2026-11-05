---
"@mcp-use/cli": patch
---

Report network failures and other operational TypeErrors with exit code 1 instead of treating them as invalid arguments. Malformed URL arguments and invalid cloud API URL configuration remain usage errors with exit code 2. Malformed view resource URIs returned by MCP servers are operational failures with exit code 1.

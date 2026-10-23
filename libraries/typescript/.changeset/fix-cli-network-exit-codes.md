---
"@mcp-use/cli": patch
---

Report network failures and other operational TypeErrors with exit code 1 instead of treating them as invalid arguments. Validate user-supplied URLs at the input boundary to preserve exit code 2 for malformed arguments and cloud API URL configuration while treating invalid remote URLs as operational failures.

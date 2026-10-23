---
"@mcp-use/cli": patch
---

Report network failures and other operational TypeErrors with exit code 1 instead of treating them as invalid arguments. Preserve exit code 2 for argument parsing and invalid URL errors.

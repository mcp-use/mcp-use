---
"mcp-use": patch
---

Preserve quoted paths and arguments in `mcp-use client connect --stdio` by parsing the target with shell-like quoting instead of splitting on raw spaces

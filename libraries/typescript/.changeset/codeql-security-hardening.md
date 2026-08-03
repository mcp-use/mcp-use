---
"mcp-use": patch
"@mcp-use/client": patch
"@mcp-use/inspector": patch
---

Harden browser launching, Inspector routes, and browser persistence. OAuth
session values are encrypted at rest, secret connection fields are no longer
persisted, Inspector assets and proxy/OAuth APIs are rate-limited, and CLI
browser opening now validates HTTP(S) targets and uses shell-free launchers.

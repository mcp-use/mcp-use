---
"@mcp-use/inspector": patch
"@mcp-use/cli": patch
---

Drop three type exports that nothing imports. They are used only inside their own modules, so this is not a change to any reachable API.

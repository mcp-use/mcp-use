---
"@mcp-use/inspector": patch
"mcp-use": patch
---

Skip `dev/info` tunnel probes unless `mcp-use dev` injects `window.__MCP_DEV_CLI__`.

**@mcp-use/inspector**
- Gate tunnel metadata probes on `window.__MCP_DEV_CLI__ === true` instead of treating a missing `__MCP_INSPECTOR_MODE__` as non-standalone.

**mcp-use**
- Set `MCP_USE_DEV_CLI` in the dev CLI and inject `window.__MCP_DEV_CLI__ = true` into the Inspector shell so embedded dev sessions still sync tunnel state.

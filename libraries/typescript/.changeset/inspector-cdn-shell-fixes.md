---
"@mcp-use/inspector": patch
---

Fix the CDN bundle when served by a backend-less shell (the upcoming
SDK v2 `/inspector` route):

- Auto-connect now reads the connect URL the SDK v2 shell injects as
  `window.__MCP_USE_INSPECTOR__.autoConnectUrl` instead of requiring the
  inspector backend's `config.json` endpoint.
- The version badge and MCP `clientInfo` fall back to the compile-time
  bundle version when `window.__INSPECTOR_VERSION__` is not injected,
  instead of reporting a hardcoded `1.0.0`.

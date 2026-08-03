---
"@mcp-use/client": patch
"@mcp-use/inspector": patch
"mcp-use": patch
---

Make Inspector connection modes authoritative for MCP proxy routing. Auto mode now attempts a direct browser connection before falling back to the configured CORS proxy, Direct mode never uses or falls back to the proxy, and Proxy mode uses it immediately. Clear stale proxy settings when an existing Inspector connection changes modes, keep the server's built-in Inspector on direct origin-level OAuth metadata discovery when no proxy backend is mounted, bypass the browser HTTP cache for OAuth metadata so Origin-specific CORS responses cannot be reused across Inspector origins, make the server-tile Authenticate action clear stored OAuth discovery before starting a fresh flow, and discard authorization-server-generated client secrets from public browser DCR results instead of persisting them.

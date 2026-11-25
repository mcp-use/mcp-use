---
"@mcp-use/client": patch
---

Start a new session when a 2025-era Streamable HTTP server answers 404 for the current `Mcp-Session-Id`, as the MCP transport spec requires, and retry the failed request once. Previously, after a server restart or session expiry, every request failed with 404 while the connector still reported itself connected. Concurrent requests that hit the expired session share one replacement.

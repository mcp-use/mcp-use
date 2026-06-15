---
"@mcp-use/inspector": patch
---

Fix chat for localhost MCP servers in the hosted inspector (MCP-2419). When the inspector runs in hosted mode the Chat tab streams through the managed cloud backend, which connects to the MCP server server-side and cannot reach a user's `localhost` server — the request 502s and surfaced in the browser as an opaque CORS / "Failed to fetch" error. Loopback server URLs now fall back to client-side (in-browser) chat streaming, and the configure-key empty state explains why the managed key is unavailable and that a personal API key is needed. The notice only appears in hosted mode; the local inspector is unchanged.

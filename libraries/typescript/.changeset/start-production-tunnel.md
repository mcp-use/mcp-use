---
"mcp-use": minor
"@mcp-use/cli": minor
---

Add `mcp-use start --tunnel` for production builds. The command waits for the server to bind, tunnels the actual port, prints the public MCP URL, reuses saved tunnel state, and releases the tunnel during startup failure or graceful shutdown. It composes with `--host` and `--with-inspector` while keeping tunnel code out of ordinary production startup.

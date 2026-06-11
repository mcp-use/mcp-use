---
"mcp-use": patch
---

Fix `TypeError: Invalid URL` when an MCP server is reached through a multi-hop proxy/tunnel chain. `X-Forwarded-Proto` and `X-Forwarded-Host` are comma-separated lists when a request passes through more than one proxy (e.g. a tunnel where the edge sets `https` and the local hop appends `http`, yielding `https,http`). The server now uses the leftmost (original client-facing) value when reconstructing the request URL instead of interpolating the whole list into an invalid URL like `https,http://host/mcp`.

---
"@mcp-use/cli": patch
"mcp-use": patch
---

Pre-bundle the non-React MCP Apps view runtime dependencies so cold dev views finish mounting instead of entering a Vite full-reload loop before HMR can take over.

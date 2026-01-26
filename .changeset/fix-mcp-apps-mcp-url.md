---
"@mcp-use/inspector": patch
"mcp-use": patch
---

fix(mcp-apps): inject window.__mcpPublicUrl and fix console logging serialization

- Fixed missing window.__mcpPublicUrl injection in MCP Apps widget endpoints, ensuring useWidget's mcp_url is properly populated in dev mode
- Fixed DataCloneError when logging non-cloneable objects (Response, Request, Error, etc.) by adding serialization to console interceptor
- The double-iframe sandbox architecture was bypassing the injection that Apps SDK widgets receive, causing mcp_url to be empty in MCP Apps

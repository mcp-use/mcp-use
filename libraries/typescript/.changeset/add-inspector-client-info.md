---
"@mcp-use/inspector": patch
"mcp-use": patch
"@mcp-use/cli": patch
---

Add configurable clientInfo support for MCP connection initialization. Clients can now customize how they identify themselves to MCP servers with full metadata including name, title, version, description, icons, and website URL. The clientConfig option is deprecated in favor of deriving it from clientInfo. Default clientInfo is set for mcp-use, inspector sets "mcp-use Inspector" with its own version, and CLI sets "mcp-use CLI".


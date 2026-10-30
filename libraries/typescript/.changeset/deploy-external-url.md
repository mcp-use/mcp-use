---
"@mcp-use/cli": minor
"create-mcp-use-app": patch
---

Add `mcp-use deploy --external-url` to register or update an already-hosted MCP server. Validate its MCP handshake before cloud authentication or registration, and fail without changing cloud state for non-MCP URLs. Update the Neon template instructions to use the new command.

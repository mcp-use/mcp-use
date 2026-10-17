---
"@mcp-use/client": patch
---

Validate discovered OAuth metadata with the official SDK before classifying an anonymous MCP connection as mixed auth. Root metadata for a different resource no longer causes public endpoints to appear to require authentication.

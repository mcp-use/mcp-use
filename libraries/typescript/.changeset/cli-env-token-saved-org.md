---
"@mcp-use/cli": patch
---

fix(cli): a key from `MANUFACT_TOKEN` or `MCP_USE_API_KEY` no longer inherits the organization saved with a different logged-in key, which failed with "The saved organization is no longer one of yours" when the two keys belong to different accounts or Clouds.

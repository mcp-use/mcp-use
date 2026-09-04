---
"@mcp-use/tunnel": patch
---

Default `localHostHeader` to `localhost` in standalone `mcp-tunnel` CLI to match `mcp-use start --tunnel` and prevent DNS-rebinding / host-validation rejections on local servers.

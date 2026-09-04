---
"@mcp-use/tunnel": patch
---

Default `localHostHeader` to `localhost` in standalone `mcp-tunnel` CLI to match `mcp-use start --tunnel` and prevent DNS-rebinding / host-validation rejections on local servers, and add `--local-host` to customize the forwarded `Host` header. Note that requests forwarded to the local server now receive `Host: localhost` by default; apps requiring the public tunnel hostname can read `x-forwarded-host`.

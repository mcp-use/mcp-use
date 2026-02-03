---
"@mcp-use/cli": minor
---

Update CLI to Manufact branding and fix authentication issues

- Changed default web URL from `mcp-use.com` to `manufact.com` for login flow
- Fixed 431 "Request Header Fields Too Large" error by increasing callback server header limit to 16KB
- Updated all user-facing messages to reference "Manufact" instead of "mcp-use"
- Updated dashboard, inspector, and settings URLs to use `manufact.com` domain
- Kept gateway domain as `run.mcp-use.com` for backward compatibility with existing deployments

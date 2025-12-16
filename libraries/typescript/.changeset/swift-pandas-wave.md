---
"mcp-use": patch
"@mcp-use/cli": patch
"@mcp-use/inspector": patch
---

## Inspector: Faster Direct-to-Proxy Fallback

- **Reduced connection timeout from 30s to 5s** for faster fallback when direct connections fail
- **Removed automatic HTTP → SSE transport fallback** since SSE is deprecated
  - Added `disableSseFallback` option to `HttpConnector` to prevent automatic fallback to SSE transport
  - Inspector now explicitly uses HTTP transport only, relying on Direct → Proxy fallback instead
  - Users can still manually select SSE transport if needed
- **Total fallback time: ~6 seconds** (5s timeout + 1s delay) instead of ~31 seconds

## Deployment: Fixed Supabase Health Check

- **Fixed deploy.sh MCP server health check** to use POST instead of GET
  - SSE endpoints hang on GET requests, causing script to timeout
  - POST requests return immediately (415 error), proving server is up
  - Script now correctly detects when deployment is complete and shows success summary with URLs
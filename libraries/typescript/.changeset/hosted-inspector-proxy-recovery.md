---
"@mcp-use/client": patch
"@mcp-use/inspector": patch
"mcp-use": patch
---

Restore complete Inspector relay support for MCP transport and OAuth discovery, registration, and token exchange in standalone and embedded deployments. Keep confidential dynamic-client secrets in the server-side BFF, recover stale per-server browser OAuth and connection storage safely, isolate callback exchange from background reconnects, and tolerate unsupported optional inventory methods.

Improve Inspector diagnostics and connection-list behavior with inline error details, a localhost recovery command for hosted callback rejections, newest-first servers, bottom scroll spacing, reliable favicon loading, and versioned revalidated standalone assets.

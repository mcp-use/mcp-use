---
"@mcp-use/client": patch
"@mcp-use/inspector": patch
"create-mcp-use-app": patch
"mcp-use": patch
---

Restore complete Inspector relay support for MCP transport and OAuth discovery, registration, and token exchange. Keep confidential dynamic-client secrets in the server-side BFF, recover stale per-server browser OAuth and connection storage safely, isolate callback exchange from background reconnects, and tolerate unsupported optional inventory methods.

Improve Inspector diagnostics and connection-list behavior with inline error details, a localhost recovery command for hosted callback rejections, newest-first servers, bottom scroll spacing, reliable favicon loading, and versioned revalidated standalone assets.

Make the Inspector project-pinned local development tooling. Generated projects install `@mcp-use/inspector` as a dev dependency, and `mcp-use dev` dynamically calls its framework-neutral `mountInspector()` on the existing listener. The installed package now owns the only MCP/OAuth proxy and serves its bundled UI locally; production handlers no longer expose an Inspector shell or duplicate proxy implementation.

---
"@mcp-use/inspector": patch
"@mcp-use/cli": patch
---

`mcp-use screenshot` now fails with a stable `view_load_failed` code instead of writing a PNG when the MCP App itself fails to initialize (a bad resource, a sandbox connect failure, or an initialize-handshake failure). This is baseline behavior, not opt-in. `console.error` calls, uncaught errors, and unhandled rejections a widget logs after it has successfully initialized continue to be ignored, since those are frequently recoverable and treating them as failures would create false positives.

---
"@mcp-use/cli": patch
---

Use Vite's native file watching on Windows instead of forcing 100ms polling. Polling delays the watcher's initial scan, which can swallow an edit made during startup so no change event is ever emitted.

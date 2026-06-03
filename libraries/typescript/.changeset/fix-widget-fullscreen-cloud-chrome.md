---
"@mcp-use/inspector": patch
---

Fix MCP App and ChatGPT App widget fullscreen overlays rendering below embedded host chrome (e.g. cloud chat headers). Fullscreen shells are portaled to `document.body` at `z-[100]`, expose `data-mcp-widget-fullscreen` on the document root for hosts, and show the exit navbar in CSS fullscreen fallback for Apps SDK widgets.

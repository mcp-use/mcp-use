---
"@mcp-use/inspector": patch
---

Fix cloud chat widget fullscreen (MCP-2181): prefer native `requestFullscreen()` on the iframe wrapper so the widget stays mounted and host chrome is hidden via the browser top layer. Route widget `ui/request-display-mode` through the same path; avoid resetting MCP Apps / OpenAI load state on display-mode toggles. CSS `fixed inset-0` overlay applies only when the Fullscreen API fails. Sets `data-mcp-widget-fullscreen` on the document root for optional host chrome hiding in CSS fallback.

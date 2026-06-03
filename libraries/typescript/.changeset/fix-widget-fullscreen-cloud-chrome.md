---
"@mcp-use/inspector": patch
---

Fix cloud chat widget display modes (MCP-2181): native fullscreen on the widget shell with exit navbar; PiP portaled to `document.body` at `z-[100]`. Reconnect AppBridge after sandbox iframe remounts so display-mode toggles do not leave the widget stuck loading. Sets `data-mcp-widget-display-mode` on the document root.

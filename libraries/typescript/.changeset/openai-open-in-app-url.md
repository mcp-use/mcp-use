---
"mcp-use": minor
"@mcp-use/cli": patch
"@mcp-use/inspector": patch
---

Add `widgetMetadata.openai.openInAppUrl` for ChatGPT Apps SDK widgets. When set, mcp-use injects the configured URL and calls `window.openai.setOpenInAppUrl({ href })` on widget load.

---
"mcp-use": minor
---

Add ChatGPT "Open in app" URL support for widgets. Widgets can now call `setOpenInAppUrl(href)` from `useWidget()` to control the link ChatGPT's "Open in app" affordance points to (ChatGPT Apps SDK only — a no-op on MCP Apps hosts and the URL-params fallback). For a static URL, set `metadata.openai.openInAppUrl` in the widget definition and it is applied automatically via `window.openai.setOpenInAppUrl` when the widget mounts inside ChatGPT.

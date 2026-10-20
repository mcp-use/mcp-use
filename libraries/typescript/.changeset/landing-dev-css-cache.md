---
"@mcp-use/cli": patch
---

Fix `landing.tsx` pages in `mcp-use dev` losing their styles or not hydrating after reopening a closed tab or navigating back. The page head now links its stylesheets at their own `?direct` URLs, so the browser no longer caches the stylesheet and the hydration entry's import of it under the same URL.

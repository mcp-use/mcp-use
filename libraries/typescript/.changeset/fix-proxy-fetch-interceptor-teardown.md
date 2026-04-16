---
"mcp-use": patch
---

Fix inspector "Protected resource does not match" error when switching from Via Proxy to Direct connection. The `window.fetch` interceptor installed by `BrowserOAuthClientProvider` is now correctly restored when `useMcp` unmounts, preventing the stale proxy interceptor from interfering with subsequent direct OAuth flows.

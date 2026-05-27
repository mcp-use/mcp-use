---
"mcp-use": patch
---

Fix two browser OAuth callback bugs in `onMcpAuthorization()`:

- The popup window navigating itself to the dashboard URL when `window.opener` was severed (COOP / cross-origin redirects / browser tab grouping). Detect "is this a popup we opened?" via `window.name.startsWith("mcp_auth_")` and render an in-place close-window message instead of redirecting to `returnUrl`. The genuine popup-blocker / manual-link case (top-level navigation, not a popup window) still redirects to `returnUrl` as before.
- "Invalid or expired state" surfaced to the parent after a successful flow when `onMcpAuthorization()` was invoked more than once in the same page load (HMR, React strict-mode double invocation, Suspense re-mount). Re-invocations now reuse the original promise via a module-level cache, so they never re-exchange the code or post a stale `success: false` to the opener.

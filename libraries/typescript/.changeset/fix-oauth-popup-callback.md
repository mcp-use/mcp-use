---
"mcp-use": patch
---

Fix browser OAuth popup callback edge cases in `onMcpAuthorization()`:

- The popup window navigating itself to the dashboard URL when `window.opener` was severed (COOP / cross-origin redirects / browser tab grouping). Detect "is this a popup we opened?" via `window.name.startsWith("mcp_auth_")` and render an in-place close-window message instead of redirecting to `returnUrl`. The genuine popup-blocker / manual-link case (top-level navigation, not a popup window) still redirects to `returnUrl` as before.
- "Invalid or expired state" surfaced to the parent after a successful flow when `onMcpAuthorization()` was invoked more than once in the same page load (HMR, React strict-mode double invocation, Suspense re-mount). Re-invocations now reuse the original promise via a module-level cache, so they never re-exchange the code or post a stale `success: false` to the opener.
- The lost-opener popup branch saved tokens but had no way to notify the parent, leaving `useMcp` stuck in `authenticating` until a hard refresh. Both the popup callback and the parent `useMcp` now use a same-origin `BroadcastChannel("mcp_auth_callback")` as a fallback transport when `window.opener.postMessage` is unavailable — matching the pattern used by `oidc-client-ts` and MSAL.js for the same COOP-driven scenario.
- **`mcp-use/browser` no longer exports LangChain agents** (`MCPAgent`, `RemoteAgent`, adapters, observability, AI SDK utils). Those moved to **`mcp-use/browser/agent`** so client bundles (e.g. Next.js dashboards) that only need `MCPClient` do not pull in `@langchain/*` / `langchain`.

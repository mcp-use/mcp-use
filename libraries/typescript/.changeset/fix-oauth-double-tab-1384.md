---
"@mcp-use/inspector": patch
---

fix(inspector): OAuth flow no longer leaves two tabs open (#1384)

Previously, connecting to an OAuth-protected MCP server from the inspector opened the authorization page in a new tab, and after the user authorized the app the callback redirected back to the inspector inside that second tab — leaving the user with two inspector tabs.

The inspector now uses the same-tab redirect flow (`useRedirectFlow: true`) combined with `preventAutoAuth: true`, so the OAuth authorization page opens in the current tab and the callback navigates the same tab back to the original inspector URL. The user ends up with a single tab.

The `Authenticate` anchor no longer sets `target="_blank"` / `rel="noopener noreferrer"` — clicking it now navigates the current tab directly to the stored auth URL. All connection entry points in the inspector (`handleAddConnection`, the `Layout` adapter, and the `InspectorDashboard` adapter used by `handleUpdateConnection` on URL edits, as well as `useAutoConnect`) propagate the same flags so the single-tab behavior is consistent across manual connect, URL edits, and auto-connect from shared config.

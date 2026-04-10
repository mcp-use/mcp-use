---
"mcp-use": minor
"@mcp-use/inspector": patch
---

Add `updateServerMetadata()` to `McpClientProvider` for metadata-only updates that do not trigger a reconnection.

`updateServer()` continues to disconnect and remount the connection for any connection-affecting change (URL, headers, proxy, transport). `updateServerMetadata(id, { name })` updates the configured display name in place without touching the live connection.

The Inspector uses this new path to let users set editable server aliases in the connection settings dialog. Alias-only edits no longer cause a full reconnect. All Inspector surfaces (dashboard tiles, server dropdown, header export actions, command palette, server info modal, server icon) now resolve the display name through a shared `getServerDisplayName` utility that prefers user-set aliases over server-reported metadata.

Also fixes an IME composition issue where pressing `Enter` during Chinese/Japanese/Korean input could accidentally submit the connection form.

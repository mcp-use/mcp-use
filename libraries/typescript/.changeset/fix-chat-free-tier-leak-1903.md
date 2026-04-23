---
"@mcp-use/inspector": patch
---

fix(inspector): hide Manufact free-tier "Model & usage" dialog when host app embeds `ChatTab` with its own session (MCP-1903)

The cloud dashboard chat was leaking the hosted inspector's free-tier sign-in / bring-your-own-key modal (plus the "anthropic/server-managed" model badge) even though it passed `hideModelBadge={true}` and already had its own authenticated session and model selector.

`ChatTab` was auto-deriving `freeTierInfo` from `isManaged` (i.e., the mere presence of `managedLlmConfig`), and both the badge and `ConfigurationDialog` treated `freeTierInfo` as an override that forces the UI back on regardless of `hideModelBadge` / `hideConfigButton`.

Free-tier upgrade UI is now opt-in via a new `enableFreeTierUpgrade?: boolean` prop on `ChatTab` (default `false`), plumbed through `EmbeddedConfig.chatEnableFreeTierUpgrade`. The hosted inspector (`inspector.manufact.com`) auto-seeds it to `true`; host apps that embed `ChatTab` directly (e.g. the cloud dashboard) leave it off and their hide-\* props are respected.

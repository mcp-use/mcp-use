---
"mcp-use": patch
"@mcp-use/inspector": patch
---

Fix OAuth callback URL for inspector mounted at a sub-path

**mcp-use:** Add `defaultCallbackUrl` prop to `McpClientProvider` so apps mounted at a sub-path (e.g. `/inspector`) can declare the correct OAuth redirect URL once at the provider level instead of passing it to every `addServer` call.

**inspector:** Pass `defaultCallbackUrl` pointing to `/inspector/oauth/callback`, which is where the React Router (with `basename="/inspector"`) mounts the `OAuthCallback` component. Previously the callback URL defaulted to `/oauth/callback`, causing a blank screen after OAuth because the route was never matched. The "Redirect URL" field has been removed from the authentication dialog — it was never wired to the actual connection and could not be set to a path the inspector would handle.

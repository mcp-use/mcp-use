---
"mcp-use": minor
"@mcp-use/inspector": minor
---

Add support for pre-registered OAuth client IDs (proxy mode), including optional client secrets for confidential clients.

`UseMcpOptions` / `McpServerOptions` now accept an `oauth: { clientId?, clientSecret?, scope? }` field. When `clientId` is provided, `BrowserOAuthClientProvider` returns it from `clientInformation()` so the SDK skips Dynamic Client Registration — required for MCP servers that proxy through providers like Slack or WorkOS, which strip `registration_endpoint` from metadata. When `clientSecret` is also provided, the SDK auto-switches token-endpoint auth from `none` to `client_secret_basic`/`client_secret_post`, which is useful for providers that don't support PKCE. `scope` is forwarded as `clientMetadata.scope`.

The Inspector's Authentication dialog now has `Client ID`, `Client Secret`, and `Scope` fields, all wired through `addServer` / `updateServer`.

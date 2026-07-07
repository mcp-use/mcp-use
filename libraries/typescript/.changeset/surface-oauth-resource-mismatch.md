---
"mcp-use": patch
---

Fix the silent OAuth authentication loop on resource mismatch (MCP-2678).

When MCP traffic is tunneled through a gateway/inspector proxy, the OAuth proxy rewrites the protected-resource-metadata `resource` field to the connection (proxy) URL so transport-anchored auth runs validate. Manual `authenticate()` runs validate against the real server URL instead, so the SDK's strict check threw `Protected resource <proxy> does not match expected <server> (or origin)` — and `useMcp` swallowed the throw as the expected popup handoff, cycling `pending_auth` → `authenticating` forever without surfacing an error (seen connecting to `https://www.cubic.dev/api/mcp` and `https://mcp.predictleads.com/`).

Two fixes:

- `BrowserOAuthClientProvider` now implements the SDK's `validateResourceURL` hook: it accepts resources valid for either the requested server URL or the proxy connection URL, and in the rewrite case returns the real upstream resource (from the proxy's `_original_resource`, falling back to the server URL) so the authorization request carries the resource the OAuth server actually protects.
- `useMcp.authenticate()` no longer treats every `auth()` throw as a popup/redirect handoff: when `auth()` throws without opening a popup or preparing an authorization URL, the connection now transitions to `failed` with the error message, so UIs render the failure instead of hanging.

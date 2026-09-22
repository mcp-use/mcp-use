---
"mcp-use": minor
"@mcp-use/client": patch
---

Add `requestAuth` for authentication engines that need the full HTTP request.
The `requestAuth` and `oauth` options cannot be used together.

Add optional Firebase authentication through Better Auth, with configurable
session checks and separate SQL tables created by explicit migrations.

Add `createOAuthMcpAuth` for registered OAuth/OIDC clients whose upstream provider
does not support dynamic client registration. Configure discovery or explicit
endpoints and profile mapping while reusing the same MCP authorization engine.
Strict sessions check upstream token introspection or a provider status callback
before MCP requests and token issuance or renewal. Revocation ends the session;
outages temporarily deny access. Each login retains its own encrypted token
reference. Upgrading requires an explicit migration and fresh login for existing
sessions switched to strict mode. Independent sessions remain an explicit option.

Register HTTP loopback callbacks as native OAuth clients so local clients work
with issuers that require this registration type.

Wait up to one second for a client's active token operation before rejecting a
busy request. Do not advertise retries after an uncertain database outcome.

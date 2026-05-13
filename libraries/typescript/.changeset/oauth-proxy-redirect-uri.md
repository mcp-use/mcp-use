---
"mcp-use": patch
---

fix(server/oauth): `oauthProxy` now correctly mediates the redirect flow

Previously the proxy forwarded the MCP client's `redirect_uri` to the upstream
provider unchanged. That required every distinct client URL (`/inspector/oauth/callback`,
agent loopback ports, prod deployments, etc.) to be pre-registered in the
provider's "Allowed Callback URLs" — defeating the point of the proxy.

The proxy now:

- Forwards `/authorize` to the upstream with `redirect_uri = <server>/oauth/callback`
  and a server-minted `state`. The original client `redirect_uri` and `state`
  are stored against that minted value in a pluggable in-flight state store
  (in-memory by default, 10-minute TTL, one-shot consumption).
- Exposes `GET /oauth/callback`. When the upstream provider redirects there,
  the proxy looks up the original client URI and 302s to it with the auth
  code and original `state`. `error` and `error_description` are propagated
  the same way.
- Overrides `redirect_uri` in `/token` form bodies so the upstream's
  redirect-uri match succeeds (the value at token exchange must match the
  one used at `/authorize`).
- Accepts an optional `allowedClientRedirectUris: string[]` on `oauthProxy()`
  to gate which client redirect URIs the proxy will broker. Unset =
  accept any URL (developer-friendly default). Set in production to close
  the open-redirect vector.

**Action required:** add `<your-server>/oauth/callback` to your upstream
provider's Allowed Callback URLs and remove any client-specific entries
(e.g. `/inspector/oauth/callback`) that were registered solely to work
around the previous behavior. The MCP client's own callback page does not
need to change.

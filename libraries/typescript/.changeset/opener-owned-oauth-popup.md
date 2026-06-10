---
"mcp-use": minor
---

fix(react/auth): opener-owned OAuth popup flow so connections never get stuck in "authenticating"

The browser OAuth popup handoff was fire-and-forget: `authenticate()` opened the
popup and then relied on a single `mcp_auth_callback` push message from the
callback page to leave the `authenticating` state. Any lost message (popup
closed early, severed `window.opener` under COOP, partitioned BroadcastChannel,
or a provider remount racing the callback) stranded the UI on "Authenticating…"
until a hard refresh — even though tokens were already persisted.

Adopt the pattern used by mature browser OAuth libraries (auth0-spa-js,
oidc-client-ts, msal-browser): the window that opens the popup owns a promise
that always settles on one of four outcomes.

- New `runAuthPopup()` helper (exported from `mcp-use/auth`) settles on the
  first of: a `state`-matched result message (postMessage **or**
  BroadcastChannel), the popup being closed, a `storage` event for the flow's
  tokens key (robust to severed/partitioned channels), or a timeout. The close
  and timeout paths check persisted tokens before declaring
  cancelled/timeout, so a "missed message but tokens landed" case still
  succeeds.
- `useMcp().authenticate()` now awaits `runAuthPopup()` and owns every state
  transition: success reconnects, cancelled/timeout return to `pending_auth`
  (re-enabling the Authenticate button), and error fails the connection.
- The OAuth callback page stamps result payloads with the originating `state`
  and `serverUrlHash`. The always-on callback listener now scopes results to
  the right server and won't clobber an already-`ready` connection with a late
  failure message.

fix(react): stop wiping OAuth credentials on routine lifecycle churn

Persisted OAuth credentials (tokens / client_info / PKCE verifier) are user
state, not connection state, and were being destroyed by ordinary lifecycle
events — silently logging users out and (when a popup completed after a
remount) breaking the flow entirely.

- `McpClientProvider`'s `removeServer(id)` no longer clears OAuth storage by
  default. Pass `removeServer(id, { clearCredentials: true })` for an explicit
  logout / "forget this server" action (the Inspector's delete-server button
  now does). This is a behavior change to `removeServer`; the signature stays
  backward compatible.
- `updateServer()` no longer clears OAuth storage — editing options is not a
  logout. It still remounts to apply the new options.
- `useMcp` no longer wipes OAuth storage on unmount mid-flow. Stale
  authorization state records already expire via their 10-minute TTL and the
  PKCE verifier is overwritten on the next auth start, so a popup completing
  after a wrapper remount now lands cleanly.

---
"mcp-use": patch
"@mcp-use/cli": patch
---

fix(auth): handle SDK-initiated OAuth redirect on 401 in CLI connect

The SDK's `StreamableHTTPClientTransport` auto-calls `auth()` on a 401, which
in turn calls our `redirectToAuthorization()` — binding the loopback and
opening the browser before the transport throws. Two fixes so the CLI's
`connect` command picks up where the SDK left off instead of dying:

- `NodeOAuthClientProvider` exposes `hasPendingFlow` so orchestrators can
  detect that the SDK already kicked off the flow and skip straight to
  `getAuthorizationCode()` (calling `auth()` again would throw "an
  authorization is already in progress").
- `mcp-use client connect`'s `runOAuthFlow` uses `hasPendingFlow` to skip
  the duplicate `auth()` call, and `isUnauthorized` now also matches the
  rewrapped 401 that `HttpConnector` throws (plain `Error` with `code = 401`).

Without these, the first connect to an OAuth-protected server printed
"Authentication required" and `process.exit(1)`'d before the browser
callback returned — leaving the user staring at a "connection refused"
loopback page.

# Mixed OAuth

This self-contained local demo proves the complete mixed-auth lifecycle with a
normal `MCPServer`:

- `initialize`, `tools/list`, and `public_ping` work anonymously.
- RFC 9728 protected-resource metadata advertises OAuth and the
  `demo:protected` scope.
- `protected_profile` is guarded at the HTTP boundary. Without a token it
  returns a real `401` and a `WWW-Authenticate` challenge containing
  `resource_metadata`.
- Better Auth owns dynamic client registration, PKCE, anonymous sign-in,
  consent, token issuance, refresh, and JWKS.
- After authorization, the client retries `protected_profile` with the bearer
  token and receives its result.

Everything is in memory and resets when the process stops. It is deliberately
a runnable local example, not a production identity setup.

## Run it

From this directory:

```sh
pnpm dev
```

The command starts the server at `http://localhost:3000/mcp` and opens the
embedded Inspector. If port 3000 is occupied, use the alternate URL printed by
the CLI. If the browser does not open automatically, visit
`http://localhost:3000/mcp/inspector`.

## Test the two flows

1. Connect and call `public_ping`. It succeeds without authentication.
2. Confirm the Inspector says **This server is using mixed auth.** and offers
   **Authenticate**.
3. Either click that button before calling a protected tool, or call
   `protected_profile` first to exercise deferred authentication.
4. In the OAuth window, click **Continue**, then **Allow**.
5. The window returns to the Inspector callback, closes, and the pending
   `protected_profile` call resumes successfully.
6. Call `public_ping` again to confirm public tools still work after OAuth.

The same server also accepts the standalone Inspector at
`http://localhost:4173`; connect it to `http://localhost:3000/mcp`.

## Why the server does not use `MCPServer({ oauth })`

The `oauth` constructor option intentionally protects the complete MCP
endpoint. This demo instead composes the public v2 server with
`oauthMetadata(...)` globally and `bearerAuth(...)` only for
`tools/call:protected_profile`. That is the distinction between mixed OAuth and
whole-server OAuth.

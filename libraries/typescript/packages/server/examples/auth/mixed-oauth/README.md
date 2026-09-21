# Mixed OAuth

This self-contained local demo proves the complete mixed-auth lifecycle with a
normal `MCPServer` configured with `oauth` **and** `allowAnonymous: true`:

- `initialize`, `tools/list`, `public_ping`, and `welcome` work anonymously.
- RFC 9728 protected-resource metadata advertises OAuth and the
  `demo:protected` scope.
- `protected_profile` declares `securitySchemes: [{ type: "oauth2", scopes:
  ["demo:protected"] }]`. Without a token the server answers a real `401` with
  a `WWW-Authenticate` challenge containing `resource_metadata` and `scope`.
  A ChatGPT user agent receives the equivalent `isError` tool result carrying
  `_meta["mcp/www_authenticate"]` instead.
- `welcome` declares both `noauth` and `oauth2`, so it runs anonymously and
  personalizes its reply once the client signs in with the `profile` scope.
- `tools/list` advertises every tool's `securitySchemes` (top level and
  `_meta`) so hosts can show which tools need sign-in before calling them.
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

To run the standalone Inspector on the origin allowed by this demo:

```bash
npx @mcp-use/inspector --port 4173 --url http://localhost:3000/mcp
```

It opens `http://localhost:4173/inspector` and connects to the demo server.

## How the gate works

`MCPServer({ oauth })` alone protects the complete MCP endpoint: every request
needs a bearer token. Adding `allowAnonymous: true` moves the decision to each
tool's `securitySchemes`:

| Declaration                                        | Behavior                                                  |
| -------------------------------------------------- | --------------------------------------------------------- |
| omitted                                            | Protected; requires the provider's `requiredScopes`       |
| `[{ type: "noauth" }]`                             | Public; a supplied token is verified but not required     |
| `[{ type: "oauth2", scopes }]`                     | Protected; requires `requiredScopes` plus `scopes`        |
| `[{ type: "noauth" }, { type: "oauth2", scopes }]` | Public, with `ctx.auth` populated when a token is present |

Resource reads and prompts stay protected. Invalid or expired tokens are always
refused with `401`, even on public tools, so clients refresh promptly.

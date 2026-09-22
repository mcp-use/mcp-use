# Mixed OAuth

This self-contained local demo proves the complete mixed-auth lifecycle with a
normal `MCPServer` configured with `oauth` **and** `mixedAuth: true`:

- `initialize`, `tools/list`, `public_ping`, and `welcome` work signed out.
- RFC 9728 protected-resource metadata advertises OAuth and the
  `demo:protected` scope.
- `protected_profile` omits `auth`, so it requires sign-in with the
  provider's `requiredScopes` (`demo:protected`). Without a token the server
  answers a real `401` with a `WWW-Authenticate` challenge containing
  `resource_metadata` and `scope`. A ChatGPT user agent receives the
  equivalent `isError` tool result carrying `_meta["mcp/www_authenticate"]`
  instead.
- `welcome` declares `auth: { optional: true, scopes: ["profile"] }`, so it
  runs for everyone and personalizes its reply when the token carries
  `profile`.
- `tools/list` advertises the `securitySchemes` generated from each tool's
  `auth` (top level and `_meta`) so ChatGPT knows which tools need sign-in.
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
needs a bearer token. Adding `mixedAuth: true` lets anyone connect and list,
and moves the decision to each tool's `auth`:

| `auth`                             | Behavior                                                    |
| ---------------------------------- | ----------------------------------------------------------- |
| omitted                            | Sign-in; requires the provider's `requiredScopes`           |
| `"public"`                         | Anyone; a token that is sent is still verified              |
| `"optional"`                       | Anyone; `ctx.auth` is set when the caller is signed in      |
| `{ scopes }`                       | Sign-in; requires `requiredScopes` plus `scopes`            |
| `{ scopes, optional: true }`       | Anyone; the scopes are advertised and the callback checks them |

Resources, resource templates, and prompts take the same `auth` field and
require sign-in when it is omitted. Invalid or expired tokens are always
refused with `401`, even on public tools, so clients refresh promptly.

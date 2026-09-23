# Mixed OAuth

A test bed for mixed authentication: one `MCPServer` with `oauth` and
`mixedAuth: true`, serving every `securitySchemes` shape on tools, plus
resources, a resource template, a prompt, and views, which always need
sign-in. A built-in Better Auth server handles dynamic
client registration, PKCE, sign-in, consent, and tokens, all in memory.

Sign-in is anonymous and needs no credentials, so anyone who can reach the
server can get a token. Everything resets when the process stops. This is a
testing tool, not a production identity setup.

## Items

Names start with their access level. Every response says what the server saw:
`signed out`, or the user ID and the scopes on the token.

| Name                          | Kind              | `securitySchemes`               | Signed out                             |
| ----------------------------- | ----------------- | ------------------------------- | -------------------------------------- |
| `public_ping`                 | tool              | `[noauth]`                      | runs                                   |
| `optional_whoami`             | tool              | `[noauth, oauth2([])]`          | runs                                   |
| `optional_welcome`            | tool              | `[noauth, oauth2(["profile"])]` | runs; personalized only with `profile` |
| `protected_profile`           | tool              | omitted                         | sign-in                                |
| `protected_update_profile`    | tool              | `[oauth2(["profile"])]`         | sign-in, then step-up to `profile`     |
| `public_card`                 | tool with a view  | `[noauth]`                      | runs; view needs sign-in               |
| `protected_card`              | tool with a view  | omitted                         | sign-in; view needs sign-in            |
| `demo://protected/profile`    | resource          | n/a                             | sign-in                                |
| `demo://protected/notes/{id}` | resource template | n/a                             | sign-in                                |
| `protected_summary`           | prompt            | n/a                             | sign-in                                |

`noauth` is `{ type: "noauth" }` and `oauth2(s)` is
`{ type: "oauth2", scopes: s }`.

Everything that needs sign-in also needs the provider's required scopes,
`demo:protected` by default.

## Run it locally

From this directory:

```sh
pnpm dev
```

The server starts at `http://localhost:3000/mcp` and opens the Inspector at
`http://localhost:3000/mcp/inspector`.

## Check the flow without a host

With the server running, `pnpm check-flow` plays the part of a host. It
registers a client, signs in, consents (fully and with a scope declined),
exchanges tokens, and checks every item signed out, signed in, after a scope
step-up, and with a declined scope. It also checks bad tokens and the ChatGPT
error-result format, and exits non-zero on any failure.

```sh
pnpm dev           # in one terminal
pnpm check-flow    # in another; pass an origin to check a tunnel URL
```

## Test with and without required scopes

`REQUIRED_SCOPES` sets the provider baseline that every sign-in call needs. It
defaults to `demo:protected`.

```sh
# Default: every sign-in item needs demo:protected
pnpm dev

# No baseline: sign-in items need only a valid token
REQUIRED_SCOPES= pnpm dev
```

Without a baseline, `protected_profile` and `protected_card` advertise an
`oauth2` scheme with empty scopes on `tools/list`. ChatGPT is reported to
ignore such a scheme, so this mode is how to check whether ChatGPT still shows
sign-in for them. `optional_whoami` asks for `openid` in this mode, because
mcp-use rejects a declared `oauth2` scheme with empty scopes when the provider
has no required scopes.

## Test in Claude and ChatGPT

Both hosts need a public HTTPS URL. Use the CLI tunnel:

1. Start the tunnel once and note the `Tunnel:` URL it prints, for example
   `https://abc123.local.mcp-use.run/mcp`:

   ```sh
   pnpm dev --tunnel
   ```

   The subdomain is saved in `.mcp-use/state/tunnel.json`, so later runs reuse
   the same URL.

2. Restart with `MCP_URL` set to that URL's origin (without `/mcp`), so the
   authorization server, tokens, and protected-resource metadata all use the
   public URL:

   ```sh
   MCP_URL=https://abc123.local.mcp-use.run pnpm dev --tunnel
   ```

3. Add `https://abc123.local.mcp-use.run/mcp` as a custom connector in Claude,
   and in ChatGPT with developer mode on. Connect without signing in.

Then work through the list. The server log shows every request and its status.

- Ask for `public_ping`, `optional_whoami`, and `public_card`. They run signed
  out. Views need sign-in, so check whether ChatGPT still creates the app and
  whether `public_card` renders its view before sign-in.
- Ask for `protected_profile`. The host shows sign-in. Continue, then allow.
  The call retries and reports your user ID.
- Ask for `optional_whoami` again. It now reports the identity and scopes.
- Ask for `protected_update_profile`. A token without `profile` gets a scope
  step-up; allow `profile` and the retry succeeds. `optional_welcome` then
  personalizes its greeting.
- Ask for `optional_welcome` with a token that lacks `profile`. It runs and
  falls back to a generic greeting instead of asking for the scope.
- Read `demo://protected/profile` and `demo://protected/notes/1`, and fetch
  `protected_summary`, while signed out. Note whether the host shows sign-in or
  only an error.
- Check whether you can sign in from the host's connector settings before
  calling any sign-in tool, and whether the host fetches the tool list again
  afterwards.

### Consent and scopes

The consent page lists each requested scope with a checkbox. Uncheck a scope
to get a token without it, which is how to test a signed-in caller who lacks a
scope.

Better Auth remembers what each user already allowed and skips consent for
those scopes. To start over as a new user, sign in from a private window or
disconnect and reconnect the connector.

Every client that registers is allowed to request all demo scopes, whatever
scope it registered with, so scope step-up never fails with `invalid_scope`.

## How the gate works

`MCPServer({ oauth })` alone protects the whole MCP endpoint. Adding
`mixedAuth: true` lets anyone connect and list, and moves the decision for
each tool to its `securitySchemes`:

| `securitySchemes`              | Behavior                                                       |
| ------------------------------ | -------------------------------------------------------------- |
| omitted                        | Sign-in; needs the provider's required scopes                  |
| `[{ type: "noauth" }]`         | Anyone; `ctx.auth` is set when the caller is signed in         |
| `[{ type: "noauth" }, oauth2]` | Anyone; the scopes are advertised and the callback checks them |
| `[{ type: "oauth2", scopes }]` | Sign-in; needs the required scopes plus `scopes`               |

Resources, resource templates, views, and prompts always need sign-in with
the required scopes. Invalid or expired tokens are refused with `401` on every
request, `noauth` tools included, so clients refresh them.

# Mixed OAuth

A test bed for mixed authentication: one `MCPServer` with `oauth` and
`mixedAuth: true`, serving every `auth` value on tools, resources, resource
templates, prompts, and views. A built-in Better Auth server handles dynamic
client registration, PKCE, sign-in, consent, and tokens, all in memory.

Sign-in is anonymous and needs no credentials, so anyone who can reach the
server can get a token. Everything resets when the process stops. This is a
testing tool, not a production identity setup.

## Items

Names start with their access level. Every response says what the server saw:
`signed out`, or the user ID and the scopes on the token.

| Name                       | Kind              | `auth`                               | Signed out  |
| -------------------------- | ----------------- | ------------------------------------ | ----------- |
| `public_ping`              | tool              | `"public"`                           | runs        |
| `optional_whoami`          | tool              | `"optional"`                         | runs        |
| `optional_welcome`         | tool              | `{ optional: true, scopes: ["profile"] }` | runs; personalized only with `profile` |
| `protected_profile`        | tool              | omitted                              | sign-in     |
| `protected_update_profile` | tool              | `{ scopes: ["profile"] }`            | sign-in, then step-up to `profile` |
| `public_card`              | tool with a view  | `"public"`                           | runs; view readable |
| `protected_card`           | tool with a view  | omitted                              | sign-in; view readable |
| `demo://public/catalog`    | resource          | `"public"`                           | readable    |
| `demo://optional/greeting` | resource          | `"optional"`                         | readable    |
| `demo://protected/profile` | resource          | omitted                              | sign-in     |
| `demo://public/items/{id}` | resource template | `"public"`                           | readable    |
| `demo://protected/notes/{id}` | resource template | `{ scopes: ["email"] }`           | sign-in, then step-up to `email` |
| `public_tips`              | prompt            | `"public"`                           | runs        |
| `optional_greeting`        | prompt            | `"optional"`                         | runs        |
| `protected_summary`        | prompt            | omitted                              | sign-in     |

"Sign-in" items also need the provider's required scopes, `demo:protected` by
default.

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

Without a baseline, tools with `auth` omitted or `"optional"` advertise an
`oauth2` scheme with empty scopes on `tools/list`. ChatGPT is reported to
ignore such a scheme, so this mode is how to check whether ChatGPT still shows
sign-in for them.

## Test in Claude and ChatGPT

Both hosts need a public HTTPS URL. Start the example with the CLI tunnel:

```sh
pnpm dev --tunnel
```

Without `MCP_URL`, `mcp-use dev --tunnel` starts the tunnel before importing
the server and uses the tunnel's origin as `MCP_URL`, so the authorization
server, tokens, and protected-resource metadata all use the public URL. Add
the `Tunnel:` URL it prints, for example
`https://abc123.local.mcp-use.run/mcp`, as a custom connector in Claude, and in
ChatGPT with developer mode on. Connect without signing in.

Then work through the list. The server log shows every request and its status.

- Ask for `public_ping`, `optional_whoami`, and `public_card`. They run signed
  out, and `public_card` renders its view.
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
`mixedAuth: true` lets anyone connect and list, and moves the decision to each
item's `auth`:

| `auth`                       | Behavior                                                        |
| ---------------------------- | --------------------------------------------------------------- |
| omitted                      | Sign-in; needs the provider's required scopes                   |
| `"public"`                   | Anyone; a token that is sent is still verified                  |
| `"optional"`                 | Anyone; `ctx.auth` is set when the caller is signed in          |
| `{ scopes }`                 | Sign-in; needs the required scopes plus `scopes`                |
| `{ scopes, optional: true }` | Anyone; the scopes are advertised and the callback checks them  |

Invalid or expired tokens are refused with `401` on every item, public ones
included, so clients refresh them.

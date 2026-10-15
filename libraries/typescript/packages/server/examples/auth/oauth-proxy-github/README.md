# GitHub OAuth proxy example

GitHub OAuth apps have no dynamic client registration, so MCP clients cannot
register with GitHub directly. With `oauthProxy`, this server becomes its own
OAuth authorization server in front of GitHub:

1. The MCP client identifies itself with a client ID metadata document, or
   registers through dynamic client registration.
2. The user approves the server's consent page.
3. The server sends the browser to GitHub as one OAuth app, and exchanges
   GitHub's code on the server.
4. The client receives the server's own tokens. The GitHub client secret and
   the user's GitHub token never leave the server.

Tools call the GitHub API as the user with `upstreamToken(ctx.auth)`. The example
has two tools: `whoami` and `list-repositories`. It requests only the
`read:user` scope, so `list-repositories` shows public repositories; add `repo`
to the scopes in `src/index.ts` to include private ones.

## Create a GitHub OAuth app

In [GitHub Developer settings](https://github.com/settings/developers), choose
**OAuth Apps** > **New OAuth App**:

- **Homepage URL**: `http://localhost:3000`
- **Redirect URI**: `http://localhost:3000/mcp/oauth/callback`. This is the
  proxy's callback, whichever MCP client signs in: GitHub never sees the
  client's own redirect URI. Leave **Allow wildcard matching** off.
- **Expire user access tokens**: on. GitHub then issues refresh tokens, and the
  proxy refreshes the GitHub token on the server.

Copy the client ID, then generate a client secret.

## Run locally

```sh
cp .env.example .env
```

Set `MCP_USE_GITHUB_CLIENT_ID`, `MCP_USE_GITHUB_CLIENT_SECRET`, and `MCP_USE_OAUTH_SECRET`
(`openssl rand -base64 32`). Then start the server:

```sh
pnpm dev
```

If port 3000 is taken, `mcp-use dev` uses the next free port and prints it.
The proxy then sends that port's callback URL to GitHub, which refuses it
unless the OAuth app lists it. Free port 3000, or add the printed port's
`/mcp/oauth/callback` URL to the app's redirect URIs and use that port in the
client URL below.

On localhost the example keeps sign-ins in memory. They end when the server
restarts or reloads after a file change. To keep them, run Redis 6.2 or later
and set `MCP_USE_REDIS_URL`:

```sh
docker run --rm -p 6379:6379 redis:7
MCP_USE_REDIS_URL=redis://localhost:6379
```

Connect an MCP client to `http://localhost:3000/mcp`, for example:

```sh
claude mcp add --transport http github-proxy http://localhost:3000/mcp
```

The client opens the consent page, then GitHub. After sign-in, call `whoami`.
Its `mcpClient` field shows the client ID the client used: an HTTPS URL for a
metadata document, or `mcp_client_…` for a registered client.

## Allow only some clients

Set `MCP_USE_ALLOWED_CLIENTS` to a comma-separated list. Each entry is either a client
ID metadata document URL, which allows that one client, or an HTTPS origin,
which allows every metadata document on that origin:

```sh
MCP_USE_ALLOWED_CLIENTS=https://claude.ai,https://chatgpt.com
```

The example passes the list to the `clients` option. While it is set:

- Dynamic client registration is off, so a client that can only register
  cannot connect.
- A client with a metadata document that is not on the list sees "not allowed
  to connect".
- A client removed from the list loses its existing sign-ins for good. Listing
  it again does not bring them back.

The list controls which apps connect, not which GitHub users sign in.

## Consent page

Before it sends anyone to GitHub, the proxy asks them to approve the app that
started the sign-in. To see the page without a client, run `pnpm dev` and
open this URL, which
starts a sign-in as ChatGPT (its metadata document lists that redirect URI):

```text
http://localhost:3000/mcp/oauth/authorize?response_type=code&client_id=https%3A%2F%2Fchatgpt.com%2Foauth%2Fclient.json&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector_platform_oauth_redirect&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256
```

## Connect Claude.ai or ChatGPT

Web clients need a public HTTPS URL, and a public server needs a shared store:

1. Expose the server, for example with `pnpm dev --tunnel` or a deployment.
   The tunnel keeps its subdomain across runs (`.mcp-use/state/tunnel.json`),
   so start it once to learn its URL.
2. Set `MCP_URL` to the public origin, with no path.
3. Add `<MCP_URL>/mcp/oauth/callback` to the GitHub OAuth app's redirect URIs.
4. Set `MCP_USE_REDIS_URL` to a Redis 6.2 or later that every instance can
   reach, for example `rediss://default:<password>@<host>:6379`.

Without a shared store and a secret, `oauthProxy` refuses to start outside
localhost: sign-ins, one-time codes, and tokens must be visible to every
instance.

## Build

```sh
pnpm build
```

`mcp-use build` runs `src/index.ts` to check the server, but it serves no
requests, so it needs none of the settings above. Inside a build,
`isBuilding()` from `mcp-use` returns `true`, and the example's `requireEnv`
skips the check. `oauthProxy` itself does not ask for a secret, a store, or
the GitHub credentials then either. Redis connects on the first sign-in, so
the build never reaches it. Set the variables where the built server runs.

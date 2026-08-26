# Authentication examples

These examples verify tokens from external authorization servers directly:

- [Clerk](./clerk/)
- [Auth0](./auth0/)
- [WorkOS](./workos/)
- [Supabase](./supabase/)
- [Keycloak](./keycloak/)
- [Better Auth](./better-auth/)
- [Mixed OAuth with Better Auth](./mixed-oauth/)

The [GitHub OAuth Proxy](./github-oauth-proxy/) example brokers one fixed
GitHub OAuth App for MCP clients because GitHub does not provide Dynamic Client
Registration for OAuth Apps.

Each direct-provider example exposes only the `get-user-info` tool and never
issues, proxies, or forwards access tokens. The GitHub proxy example instead
uses the server-only upstream token to call GitHub. For public deployments, set
`MCP_URL` to the server origin (for example, `https://mcp.example.com`), not the
`/mcp` endpoint.

OAuth protects the browser landing page at `/mcp` by default. These examples
set `publicLandingPage: true` so people can open the HTML connection guide
without a bearer token. This exception applies only to GET and HEAD requests
that explicitly accept `text/html`; MCP protocol traffic remains protected.

## Commands

From a provider directory:

```sh
pnpm dev
```

`mcp-use dev` owns the local socket and serves `server.fetch` from the
default-exported server. Before importing that entry, it resolves the actual
local port and, when `MCP_URL` is absent, supplies a scoped trusted local
canonical origin. The shared handler uses `legacy: "stateless"`. Public and
tunnel deployments must set `MCP_URL` to the server origin. Copy the provider
`.env.example` to `.env` and configure it before starting the server.

The Supabase example is an exception: it runs one standalone Hono app because
it hosts auth routes alongside the MCP endpoint. The Better Auth example keeps
the regular `mcp-use` server and runs its Hono authorization server as a second
process. The mixed OAuth example is a self-contained runnable demo: public MCP
operations remain anonymous, while one protected tool is guarded by the same
OAuth verification helpers.

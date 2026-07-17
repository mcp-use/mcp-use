# Direct authentication examples

These examples use direct external authorization servers:

- [Clerk](./clerk/)
- [Auth0](./auth0/)
- [WorkOS](./workos/)
- [Supabase](./supabase/)
- [Keycloak](./keycloak/)

Each server exposes only the `get-user-info` tool. It never issues, proxies, or
forwards access tokens. For public deployments, set `MCP_URL` to the server
origin (for example, `https://mcp.example.com`), not the `/mcp` endpoint.

OAuth protects the browser landing page at `/mcp` by default. These examples
set `publicLandingPage: true` so people can open the HTML connection guide
without a bearer token. This exception applies only to GET and HEAD requests
that explicitly accept `text/html`; MCP protocol traffic remains protected.

## Commands

From a provider directory:

```sh
pnpm dev
```

`mcp-use dev` owns the local socket and calls `getHandler()` on the
default-exported server. Before importing that entry, it resolves the actual
local port and, when `MCP_URL` is absent, supplies a scoped trusted local
canonical origin. The shared handler uses `legacy: "stateless"`. Public and
tunnel deployments must set `MCP_URL` to the server origin. Copy the provider
`.env.example` to `.env` and configure it before starting the server.

The Supabase example is an exception: it runs a standalone Hono app (via
`tsx`) because it hosts Supabase's consent UI alongside the MCP endpoint, and
therefore cannot use the `mcp-use` CLI.

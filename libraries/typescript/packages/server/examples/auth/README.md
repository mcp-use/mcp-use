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

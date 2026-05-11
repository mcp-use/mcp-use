# Clerk Authentication

Setting up OAuth with Clerk. DCR mode only — MCP clients register themselves directly with Clerk via Dynamic Client Registration; the MCP server only verifies the resulting JWTs against Clerk's JWKS.

**Learn more:** [Clerk OAuth Docs](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth) · [Runnable example](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use/examples/server/oauth/clerk)

---

## Quick Start

```typescript
import { MCPServer, oauthClerkProvider, object } from "mcp-use/server";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  oauth: oauthClerkProvider(),
});

server.tool(
  { name: "whoami", description: "Get authenticated user info" },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      email: ctx.auth.user.email,
      name: ctx.auth.user.name,
    })
);

server.listen();
```

With a `.env` file:

```bash
# Development:  https://[verb-noun-##].clerk.accounts.dev
# Production:   https://clerk.[YOUR_APP_DOMAIN].com
MCP_USE_OAUTH_CLERK_FRONTEND_API_URL=https://verb-noun-42.clerk.accounts.dev
```

That's it. JWT verification, OAuth discovery, and `.well-known` passthrough are handled automatically.

---

## Setup

1. Sign up at [clerk.com](https://clerk.com) and create an application.
2. **Clerk Dashboard → Configure → OAuth Applications** — enable **Dynamic Client Registration**. This is required for MCP clients to self-register.
3. **Clerk Dashboard → Configure → API Keys** — copy the **Frontend API URL** (shown in the `.env.local` quickstart).
   - Development example: `https://verb-noun-42.clerk.accounts.dev`
   - Production example: `https://clerk.yourdomain.com`

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_USE_OAUTH_CLERK_FRONTEND_API_URL` | Yes | Clerk Frontend API URL (e.g. `https://verb-noun-42.clerk.accounts.dev`) |

---

## Configuration Options

Zero-config (reads from env vars):

```typescript
oauth: oauthClerkProvider()
```

Explicit config (overrides env vars):

```typescript
oauth: oauthClerkProvider({
  frontendApiUrl: "https://verb-noun-42.clerk.accounts.dev",
  verifyJwt: process.env.NODE_ENV === "production",  // default: true
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `frontendApiUrl` | `string` | env var | Clerk Frontend API URL |
| `verifyJwt` | `boolean?` | `true` | Set `false` to skip JWT verification (**development only**) |

---

## User Context

Clerk populates these fields on `ctx.auth.user`:

| Field | Type | Source |
|-------|------|--------|
| `userId` | `string` | `sub` claim |
| `email` | `string?` | `email` claim |
| `name` | `string?` | `name` claim |
| `roles` | `string[]?` | `roles` claim |
| `permissions` | `string[]?` | `permissions` claim |

### Organization Context

Clerk includes the active organization on the JWT payload. The fields are non-standard, so cast off `ctx.auth.user`:

```typescript
server.tool(
  { name: "get-organization-info", description: "Get the active organization" },
  async (_args, ctx) => {
    const { org_id, org_role, org_slug } = ctx.auth.user as {
      org_id?: string;
      org_role?: string;
      org_slug?: string;
    };

    if (!org_id) {
      return error("No active organization. Select one in Clerk first.");
    }

    return object({ org_id, org_role, org_slug });
  }
);
```

---

## Common Mistakes

- **DCR not enabled** — If MCP Inspector stalls at the registration step, confirm **Dynamic Client Registration** is enabled in Clerk Dashboard → Configure → OAuth Applications. Without DCR, there is no `client_id` for MCP clients to obtain.
- **Wrong Frontend API URL** — Must be the full URL (with `https://`), not just the subdomain.
- **Skipping JWT verification in production** — `verifyJwt: false` is development only.

---

## Next Steps

- **Auth overview** → [overview.md](overview.md)
- **Auth0 setup** → [auth0.md](auth0.md)
- **WorkOS setup** → [workos.md](workos.md)
- **Build tools** → [../server/tools.md](../server/tools.md)

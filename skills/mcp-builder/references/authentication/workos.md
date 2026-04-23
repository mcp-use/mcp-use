# WorkOS Authentication

Setting up OAuth with WorkOS AuthKit. DCR mode only — MCP clients register themselves directly with WorkOS; the MCP server just verifies the resulting tokens.

**Learn more:** [WorkOS AuthKit MCP docs](https://workos.com/docs/authkit/mcp) · [Runnable example](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use/examples/server/oauth/workos)

---

## Quick Start

```typescript
import { MCPServer, oauthWorkOSProvider, object } from "mcp-use/server";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  oauth: oauthWorkOSProvider(),
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
MCP_USE_OAUTH_WORKOS_SUBDOMAIN=your-company.authkit.app
```

That's it. JWT verification, OAuth discovery, and `.well-known` passthrough are handled automatically.

---

## Setup

1. Sign up at the [WorkOS Dashboard](https://dashboard.workos.com/) and create a project.
2. **Connect → Configuration** — enable **Dynamic Client Registration**.
3. **Configuration → Redirects** — add your MCP client redirect URI (e.g. `http://localhost:3000/callback`).
4. Copy the full AuthKit domain from **Domains → AuthKit Domain** (e.g. `your-company.authkit.app` — including `.authkit.app`, not just `your-company`).

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_USE_OAUTH_WORKOS_SUBDOMAIN` | Yes | Full AuthKit domain (e.g. `my-company.authkit.app`) |

> If you also need to call the WorkOS Management API from a tool handler, store the API key in any env var you like (e.g. `WORKOS_API_KEY`) and read it inside the tool. It's **not** part of the OAuth provider config anymore.

---

## Configuration Options

Zero-config (reads from env vars):

```typescript
oauth: oauthWorkOSProvider()
```

Explicit config (overrides env vars):

```typescript
oauth: oauthWorkOSProvider({
  subdomain: "my-company.authkit.app",
  verifyJwt: process.env.NODE_ENV === "production",  // default: true
  scopesSupported: ["email", "offline_access", "openid", "profile"],  // override advertised scopes
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `subdomain` | `string` | env var | Full AuthKit domain (e.g., `my-company.authkit.app`) |
| `verifyJwt` | `boolean?` | `true` | Set `false` to skip JWT verification (**development only**) |
| `scopesSupported` | `string[]?` | `["email", "offline_access", "openid", "profile"]` | Override advertised scopes |

---

## User Context

WorkOS populates these fields on `ctx.auth.user`:

| Field | Type | Source |
|-------|------|--------|
| `userId` | `string` | `sub` claim |
| `email` | `string?` | `email` claim |
| `name` | `string?` | `name` claim |
| `username` | `string?` | `preferred_username` claim |
| `picture` | `string?` | `picture` claim |
| `roles` | `string[]?` | `roles` claim |
| `permissions` | `string[]?` | `permissions` claim |
| `email_verified` | `boolean?` | `email_verified` claim |
| `organization_id` | `string?` | `org_id` claim — multi-tenant org ID |
| `sid` | `string?` | Session ID |

### Role-Based Access

```typescript
server.tool(
  { name: "admin-action", description: "Admin-only operation" },
  async (_args, ctx) => {
    if (!ctx.auth.user.roles?.includes("admin")) {
      return error("Forbidden: admin role required");
    }

    // ... admin logic
    return text("Done");
  }
);
```

### Multi-Tenant Filtering

Scope queries to the authenticated user's organization:

```typescript
server.tool(
  { name: "get-documents", description: "Get documents for the authenticated org" },
  async (_args, ctx) => {
    // Custom claims come back as `unknown` — narrow before use
    const orgId = ctx.auth.user.organization_id as string | undefined;
    if (!orgId) return error("Organization context required");

    const documents = await db.documents.findMany({
      where: { organizationId: orgId },
    });

    return object(documents);
  }
);
```

---

## Making WorkOS API Calls

Use a WorkOS API key (not the user's access token) for management API calls:

```typescript
const WORKOS_API_KEY = process.env.WORKOS_API_KEY;

server.tool(
  { name: "get-workos-user", description: "Fetch user profile from WorkOS" },
  async (_args, ctx) => {
    if (!WORKOS_API_KEY) return error("WorkOS API key not configured");

    const res = await fetch(
      `https://api.workos.com/user_management/users/${ctx.auth.user.userId}`,
      {
        headers: {
          Authorization: `Bearer ${WORKOS_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) return error(`WorkOS API failed: ${res.status}`);
    return object(await res.json());
  }
);
```

---

## Example `.env`

```bash
# Required: Full AuthKit domain (WorkOS Dashboard → Domains → AuthKit Domain)
MCP_USE_OAUTH_WORKOS_SUBDOMAIN=my-company.authkit.app

# Optional: WorkOS API key if you call the Management API from tools
WORKOS_API_KEY=sk_test_...
```

---

## Troubleshooting

### Redirect URI Mismatch

If you get a redirect URI error during OAuth, add your client's callback URL to WorkOS:

1. WorkOS Dashboard → **Developer** → **Redirects**
2. Click **Edit redirect URIs** and add the one the client expects (e.g. `http://localhost:3000/oauth/callback`).

Changes may take a few minutes to propagate.

### DCR Not Registering

If the MCP Inspector stalls at the registration step, double-check that **Dynamic Client Registration** is enabled in WorkOS Dashboard → **Connect → Configuration**. Without DCR enabled, there's no pre-configured `client_id` for the Inspector to use.

---

## Next Steps

- **Auth overview** → [overview.md](overview.md)
- **Supabase setup** → [supabase.md](supabase.md)
- **Auth0 setup** → [auth0.md](auth0.md)
- **Build tools** → [../server/tools.md](../server/tools.md)

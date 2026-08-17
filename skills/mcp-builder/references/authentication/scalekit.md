# Scalekit Authentication

Setting up OAuth with Scalekit MCP Auth. DCR/CIMD mode only — MCP clients register themselves directly with Scalekit; the MCP server only verifies the resulting JWTs against Scalekit's JWKS.

**Learn more:** [Scalekit docs](https://docs.scalekit.com)

---

## Quick Start

```typescript
import { MCPServer, object } from "mcp-use/server";
import { oauthScalekitProvider } from "mcp-use/oauth/scalekit";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  oauth: oauthScalekitProvider(),
});

server.tool(
  { name: "whoami", description: "Get authenticated caller info" },
  async (_args, ctx) =>
    object({
      id: ctx.auth.user.id,
      subjectType: ctx.auth.user.subjectType,
      organizationId: ctx.auth.user.organizationId,
    })
);

server.listen();
```

With a `.env` file:

```bash
MCP_USE_OAUTH_SCALEKIT_ENVIRONMENT_URL=https://your-env.scalekit.dev
MCP_USE_OAUTH_SCALEKIT_RESOURCE_ID=res_your_resource
```

That's it. JWT verification, OAuth discovery, and `.well-known` passthrough are handled automatically.

---

## Setup

1. Sign up at [scalekit.com](https://www.scalekit.com) and create an environment.
2. **Scalekit Dashboard → MCP servers** — create a resource and copy the **resource id** (`res_…`). This is the JWT audience.
3. Copy the **Environment URL**.
4. Set the public MCP URL to the URL mcp-use advertises, with no trailing slash.

The verifier accepts both the environment-root issuer and the resource-scoped issuer (`{environmentUrl}/resources/{resourceId}`). Advertised metadata always uses the resource-scoped issuer. Scalekit binds tokens to the resource id.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_USE_OAUTH_SCALEKIT_ENVIRONMENT_URL` | Yes | Scalekit environment URL |
| `MCP_USE_OAUTH_SCALEKIT_RESOURCE_ID` | Yes | MCP resource id (`res_…`). This is the JWT audience. |

---

## Configuration Options

Zero-config (reads from env vars):

```typescript
oauth: oauthScalekitProvider()
```

Explicit config (overrides env vars):

```typescript
oauth: oauthScalekitProvider({
  environmentUrl: "https://your-env.scalekit.dev",
  resourceId: "res_your_resource",
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `environmentUrl` | `URL \| string` | env var | Scalekit environment URL |
| `resourceId` | `string` | env var | MCP resource id (`res_…`) |
| `audience` | `string?` | unset | Extra `aud` value required together with `resourceId` |

---

## User Context

Scalekit populates these fields on `ctx.auth.user`:

| Field | Type | Source |
|-------|------|--------|
| `id` | `string` | `sub` claim |
| `subjectType` | `"user" \| "machine"` | `"machine"` when `sub` equals `client_id` / `azp` |
| `organizationId` | `string?` | `org_id` claim |
| `sessionId` | `string?` | `sid` claim |

Permissions from the token are on `ctx.auth.permissions`, not on the user object.

---

## Common Mistakes

- **Audience is the resource id** — Do not bind verification only to the MCP URL. A token for another `res_…` in the same environment must be rejected.
- **Wrong JWKS path** — JWKS is `{environmentUrl}/keys`. `{environmentUrl}/resources/{resourceId}/keys` is a 404.
- **Custom claims** — Read them from `ctx.auth.payload`. They are not copied onto `ctx.auth.user`.
- **Missing `res_` prefix** — `resourceId` must start with `res_`. A wrong value weakens audience binding.

---

## Next Steps

- **Auth overview** → [overview.md](overview.md)
- **Build tools** → [../server/tools.md](../server/tools.md)

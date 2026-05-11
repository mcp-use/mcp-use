# Auth0 Authentication

Setting up OAuth with Auth0. Two modes depending on whether you have access to Auth0's DCR feature:

- **DCR (built-in)** → use `oauthAuth0Provider`. Requires Auth0's Early Access program.
- **OAuth proxy** → use `oauthProxy` + `jwksVerifier` with a standard Auth0 Regular Web App. No Early Access required.

**Learn more:** [Auth0 MCP Authorization Guide](https://auth0.com/ai/docs/mcp/get-started/authorization-for-your-mcp-server) · [Runnable DCR example](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use/examples/server/oauth/auth0) · [Runnable proxy example](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use/examples/server/oauth/auth0-proxy)

---

## Mode 1: DCR (`oauthAuth0Provider`)

Auth0's built-in DCR feature is currently in **Early Access**. MCP clients register and authenticate directly with Auth0. To use this, join Auth0's Early Access program — see the [Auth0 MCP Authorization Guide](https://auth0.com/ai/docs/mcp/get-started/authorization-for-your-mcp-server).

### Setup

1. **Auth0 Dashboard → Settings → Advanced** — enable **Resource Parameter Compatibility Profile**.
2. Promote connections to domain-level so third-party clients (like MCP Inspector) can use them:
   ```bash
   auth0 api get connections
   auth0 api patch connections/YOUR_CONNECTION_ID --data '{"is_domain_connection": true}'
   ```
3. Create an API with the `rfc9068_profile_authz` token dialect (this adds `permissions` to the access token):
   ```bash
   auth0 api post resource-servers --data '{
     "identifier": "https://your-api.example.com",
     "name": "MCP Tools API",
     "signing_alg": "RS256",
     "token_dialect": "rfc9068_profile_authz",
     "enforce_policies": true,
     "scopes": [{"value": "read:data", "description": "Read data"}]
   }'
   ```

### Quick Start

```typescript
import { MCPServer, oauthAuth0Provider, object } from "mcp-use/server";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  oauth: oauthAuth0Provider(),  // reads MCP_USE_OAUTH_AUTH0_DOMAIN + _AUDIENCE
});

server.tool(
  { name: "whoami", description: "Get authenticated user info" },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      email: ctx.auth.user.email,
      permissions: ctx.auth.permissions,
    })
);

server.listen();
```

With a `.env` file:

```bash
MCP_USE_OAUTH_AUTH0_DOMAIN=your-tenant.auth0.com
MCP_USE_OAUTH_AUTH0_AUDIENCE=https://your-api.example.com
```

### Configuration Options

Zero-config (reads from env vars):

```typescript
oauth: oauthAuth0Provider()
```

Explicit config:

```typescript
oauth: oauthAuth0Provider({
  domain: "your-tenant.auth0.com",
  audience: "https://your-api.example.com",
  verifyJwt: process.env.NODE_ENV === "production",  // default: true
  scopesSupported: ["openid", "profile", "email", "offline_access"],
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `domain` | `string` | env var | Auth0 tenant domain (e.g. `your-tenant.auth0.com`) |
| `audience` | `string` | env var | Auth0 API identifier |
| `verifyJwt` | `boolean?` | `true` | Set `false` to skip JWT verification (**development only**) |
| `scopesSupported` | `string[]?` | `["openid", "profile", "email", "offline_access"]` | Override advertised scopes |

---

## Mode 2: OAuth Proxy (`oauthProxy`)

Use a standard Auth0 **Regular Web Application** — no Early Access required. Your server mediates the token exchange using pre-registered credentials.

### Setup

1. **Auth0 Dashboard → Applications → Create Application** — choose **Regular Web Application**.
2. Under **Allowed Callback URLs**, add your MCP client's redirect URI (e.g. `http://localhost:3000/inspector/oauth/callback`).
3. Copy the **Client ID** and **Client Secret**.
4. **APIs → Create API** — set an identifier (e.g. `https://my-mcp-api/`), leave signing as RS256. This is required so Auth0 issues **JWT** access tokens instead of opaque tokens.

### Quick Start

```typescript
import { MCPServer, oauthProxy, jwksVerifier, object } from "mcp-use/server";

const domain = process.env.AUTH0_DOMAIN!;
const audience = process.env.AUTH0_AUDIENCE ?? "";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  oauth: oauthProxy({
    authEndpoint: `https://${domain}/authorize`,
    tokenEndpoint: `https://${domain}/oauth/token`,
    issuer: `https://${domain}/`,
    clientId: process.env.AUTH0_CLIENT_ID!,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    scopes: ["openid", "email", "profile"],
    extraAuthorizeParams: { audience },  // required for JWT access tokens
    verifyToken: jwksVerifier({
      jwksUrl: `https://${domain}/.well-known/jwks.json`,
      issuer: `https://${domain}/`,
      audience,
    }),
  }),
});

server.tool(
  { name: "whoami", description: "Get authenticated user info" },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      email: ctx.auth.user.email,
      scopes: ctx.auth.scopes,
    })
);

server.listen();
```

With a `.env` file:

```bash
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_CLIENT_ID=<from Regular Web App>
AUTH0_CLIENT_SECRET=<from Regular Web App>
AUTH0_AUDIENCE=https://my-mcp-api/
```

> **Why `extraAuthorizeParams: { audience }`?** Without the `audience` parameter on `/authorize`, Auth0 issues opaque access tokens (no JWT, can't be verified locally). The audience turns it into a standard JWT signed by your API.

See [custom.md](custom.md) for full `oauthProxy` options.

---

## Accessing user info in tools

```typescript
server.tool(
  { name: "get-user-info", description: "Get authenticated user info" },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      email: ctx.auth.user.email,
      name: ctx.auth.user.name,
      nickname: ctx.auth.user.nickname,
      picture: ctx.auth.user.picture,
      permissions: ctx.auth.permissions,
      scopes: ctx.auth.scopes,
    })
);
```

---

## Permissions

Auth0 includes permissions directly in the access token when you use the `rfc9068_profile_authz` token dialect. Check them in tool callbacks:

```typescript
server.tool(
  {
    name: "delete-document",
    description: "Delete a document (requires delete:documents)",
  },
  async ({ documentId }, ctx) => {
    if (!ctx.auth.permissions?.includes("delete:documents")) {
      return error("Forbidden: delete:documents permission required");
    }

    await db.documents.delete({ id: documentId });
    return text("Document deleted");
  }
);
```

---

## Which mode should I use?

| | DCR (`oauthAuth0Provider`) | Proxy (`oauthProxy`) |
|---|---|---|
| Requires Early Access | Yes | No |
| MCP clients self-register | Yes | No (single pre-registered app) |
| Your server mediates `/token` | No | Yes |
| Best for | Multi-client public MCP servers | Private/internal MCP servers |

If you aren't on the Auth0 DCR Early Access, use the proxy.

---

## Next Steps

- **Auth overview** → [overview.md](overview.md)
- **Custom providers + OAuth proxy reference** → [custom.md](custom.md)
- **WorkOS setup** → [workos.md](workos.md)
- **Build tools** → [../server/tools.md](../server/tools.md)

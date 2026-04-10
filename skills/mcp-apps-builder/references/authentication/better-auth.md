# Better Auth Authentication

Setting up a self-hosted OAuth 2.1 authorization server with Better Auth.

**Learn more:** [Better Auth OAuth Provider Plugin](https://better-auth.com/docs/plugins/oauth-provider) · [GitHub Example](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use/examples/server/oauth/better-auth)

> **Note:** This covers the `@better-auth/oauth-provider` plugin approach. The older Better Auth MCP plugin is deprecated. For legacy users, Better Auth provides a [mcp-use adapter](https://better-auth.com/docs/plugins/mcp#framework-adapters).

---

## How It Works

Unlike WorkOS or Supabase, Better Auth runs *inside* your MCP server — your server is the OAuth 2.1 authorization server. Better Auth handles the full OAuth flow (authorization, token issuance, JWKS); mcp-use only verifies the resulting JWTs.

This means:
- No external auth service required
- You control the login and consent UX
- Requires a database (SQLite, Postgres, etc.)
- More setup than hosted providers

---

## Install

```bash
npm install better-auth @better-auth/oauth-provider better-sqlite3
```

---

## Setup

### 1. Configure Better Auth (`auth.ts`)

```typescript
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import Database from "better-sqlite3";

export const auth = betterAuth({
  authURL: "http://localhost:3000",
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET!,

  database: new Database("./sqlite.db"),

  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },

  plugins: [
    jwt(), // Required: signs and verifies access tokens
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // Must include your MCP endpoint as a valid audience
      validAudiences: ["http://localhost:3000/mcp"],
      // Expose user profile claims in access token JWTs
      customAccessTokenClaims: async ({ user }) => ({
        email: user?.email,
        name: user?.name,
        picture: user?.image,
      }),
    }),
  ],
});
```

### 2. Generate and Migrate the Database

```bash
npx auth@latest generate
npx auth@latest migrate
```

### 3. Configure the MCP Server (`server.ts`)

The server needs three things beyond the standard `MCPServer` setup:
1. Mount Better Auth routes (`/api/auth/**`)
2. Mount OAuth discovery endpoints with CORS headers (required for browser clients)
3. Mount login and consent pages

See the [GitHub example](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use/examples/server/oauth/better-auth) or the [docs](https://mcp-use.dev/docs/typescript/server/authentication/providers/better-auth) for the full server.ts code. The key parts:

```typescript
import { MCPServer, oauthBetterAuthProvider } from "mcp-use/server";
import { auth } from "./auth.js";
import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  oauth: oauthBetterAuthProvider({
    authURL: "http://localhost:3000/api/auth",
  }),
});

// Mount Better Auth routes
server.app.on(["GET", "POST"], "/api/auth/**", (c) => auth.handler(c.req.raw));

// OAuth discovery endpoints — CORS headers required for browser clients (MCP Inspector)
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET" };
const authServerMetadataHandler = oauthProviderAuthServerMetadata(auth, { headers: corsHeaders });
server.app.get("/.well-known/oauth-authorization-server", (c) => authServerMetadataHandler(c.req.raw));
server.app.get("/.well-known/oauth-authorization-server/api/auth", (c) => authServerMetadataHandler(c.req.raw));

const openIdConfigHandler = oauthProviderOpenIdConfigMetadata(auth, { headers: corsHeaders });
server.app.get("/.well-known/openid-configuration", (c) => openIdConfigHandler(c.req.raw));
server.app.get("/.well-known/openid-configuration/api/auth", (c) => openIdConfigHandler(c.req.raw));

server.listen({ port: 3000 });
```

### 4. Add Login and Consent Pages

Better Auth requires a `/sign-in` page and a `/consent` page mounted on the Hono app. Key details:

- **Sign-in page:** POST to `/api/auth/sign-in/social` with the provider name and `callbackURL: '/api/auth/oauth2/authorize' + queryString` (preserve the OAuth query params)
- **Consent page:** POST to `/api/auth/oauth2/consent` with `{ accept: boolean, oauth_query: window.location.search.slice(1) }`
- Both must use `credentials: 'include'` on fetch calls

See the [GitHub example](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use/examples/server/oauth/better-auth) for complete login/consent page implementations.

---

## Environment Variables

```bash
BETTER_AUTH_SECRET=your-secret-change-in-production

# Social provider credentials (GitHub shown — swap for any supported provider)
# Set callback URL in provider dashboard to: http://localhost:3000/api/auth/callback/<provider>
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

Better Auth supports many social providers (GitHub, Google, Discord, etc.). See [Better Auth social providers docs](https://www.better-auth.com/docs/concepts/oauth) for the full list.

---

## Configuration Options

```typescript
oauthBetterAuthProvider({
  authURL: "https://yourapp.com/api/auth",  // Required: full URL including basePath
  verifyJwt: false,                          // Optional: skip JWT verification (dev only)
  getUserInfo: (payload) => ({ ... }),        // Optional: custom JWT claim extraction
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `authURL` | `string` | — | Better Auth base URL including `/api/auth` path |
| `verifyJwt` | `boolean?` | `true` | Set `false` to skip JWT verification (development only) |
| `getUserInfo` | `function?` | built-in | Custom function to extract user info from JWT payload |

---

## Common Mistakes

- **Missing `validAudiences`** — Must include your MCP endpoint (e.g., `http://localhost:3000/mcp`) or JWT verification will fail with audience mismatch
- **Missing CORS headers on discovery endpoints** — Browser clients like MCP Inspector require `Access-Control-Allow-Origin: *` on `/.well-known/*` routes
- **Skipping `jwt()` plugin** — Required for token signing; omitting it breaks token issuance
- **Wrong `authURL`** — `oauthBetterAuthProvider({ authURL })` must include the full basePath (e.g., `/api/auth`), not just the host
- **Missing `credentials: 'include'`** — Login and consent page fetch calls must include cookies or the session will be lost

---

## Next Steps

- **Auth overview** → [overview.md](overview.md)
- **WorkOS setup** → [workos.md](workos.md)
- **Supabase setup** → [supabase.md](supabase.md)
- **Build tools** → [../server/tools.md](../server/tools.md)

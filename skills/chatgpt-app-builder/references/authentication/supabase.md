# Supabase Authentication

Setting up OAuth with Supabase's OAuth 2.1 server. Supabase hosts `/authorize`, `/token`, `/register`, and `.well-known` discovery on your Supabase project — the MCP server only verifies the resulting JWTs.

**You host the consent UI.** Supabase redirects the browser to a URL you configure, and your route uses the Supabase JS SDK to load authorization details, render sign-in + consent, and submit the decision back to Supabase. mcp-use is not involved in that step — follow Supabase's [OAuth Server — Getting Started guide](https://supabase.com/docs/guides/auth/oauth-server/getting-started).

**Learn more:** [Supabase OAuth Server — MCP Authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication) · [Runnable example](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use/examples/server/oauth/supabase)

> This targets Supabase's **OAuth 2.1 server** — a different feature from Supabase Auth's social logins. Enable it explicitly in the dashboard under **Authentication → OAuth Server**.

---

## Quick Start

```typescript
import { MCPServer, oauthSupabaseProvider, object } from "mcp-use/server";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  oauth: oauthSupabaseProvider(),
});

server.tool(
  { name: "whoami", description: "Get authenticated user info" },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      email: ctx.auth.user.email,
    })
);

server.listen();
```

With a `.env` file:

```bash
MCP_USE_OAUTH_SUPABASE_PROJECT_ID=your-project-id
MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

JWT verification and `.well-known` passthrough are automatic. You still need to mount your own consent route (see [Hosting the consent UI](#hosting-the-consent-ui) below).

---

## Setup

1. Create (or select) a project in the [Supabase Dashboard](https://app.supabase.com/). Copy the **Project ID** from **Project Settings → General**.
2. **Authentication → OAuth Server** — enable the OAuth 2.1 server and set the **consent screen URL** to the route your MCP server will host (e.g. `http://localhost:3000/auth/consent`). Supabase appends `?authorization_id=<uuid>` when redirecting users there.
3. **Authentication → Sign In / Providers** — enable at least one sign-in method so users can authenticate before consenting:
   - **Anonymous sign-ins** — one-click guest sessions, ideal for demos
   - **Email + password**, **magic links**, or **OAuth providers** (Google, GitHub, etc.) — for real apps
4. Copy the **publishable key** (`sb_publishable_...`) from **Project Settings → API Keys**. You'll use it in the consent UI and in any tool that calls Supabase REST APIs.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_USE_OAUTH_SUPABASE_PROJECT_ID` | Yes | Your Supabase project ID |
| `MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY` | Recommended | Publishable key (`sb_publishable_...`) — used by the consent UI and any tools calling Supabase REST/APIs |
| `MCP_USE_OAUTH_SUPABASE_JWT_SECRET` | Only for legacy HS256 projects | JWT secret for HS256 verification |

> New Supabase projects issue `sb_publishable_...` keys. Legacy projects using `anon` JWT keys still work, but prefer publishable keys going forward.

### Finding Your Credentials

- **Project ID**: Project Settings → **General** → Reference ID
- **Publishable key**: Project Settings → **API Keys**
- **JWT Secret** (legacy HS256 only): Project Settings → **JWT Settings** (Legacy)

---

## Configuration Options

Zero-config (reads from env vars):

```typescript
oauth: oauthSupabaseProvider()
```

Explicit config (overrides env vars):

```typescript
oauth: oauthSupabaseProvider({
  projectId: "my-project-id",
  jwtSecret: process.env.MCP_USE_OAUTH_SUPABASE_JWT_SECRET,  // legacy HS256 only
  verifyJwt: process.env.NODE_ENV === "production",
  scopesSupported: ["openid", "profile", "email"],
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectId` | `string` | env var | Supabase project ID |
| `jwtSecret` | `string?` | env var | JWT secret for HS256 tokens (legacy projects) |
| `verifyJwt` | `boolean?` | `true` | Set `false` to skip JWT verification (**development only**) |
| `scopesSupported` | `string[]?` | `["openid", "profile", "email"]` | Override advertised scopes |

---

## JWT Signing: ES256 vs HS256

The provider auto-detects the algorithm from the token header.

- **ES256 (new projects)** — asymmetric signing via elliptic curve keys. The provider fetches the JWKS endpoint automatically. No `jwtSecret` needed.
- **HS256 (legacy projects)** — symmetric signing via a shared secret. Provide `MCP_USE_OAUTH_SUPABASE_JWT_SECRET` or `jwtSecret` in config.

---

## Hosting the consent UI

Supabase redirects the browser to the consent screen URL you configured. Your route must:

1. Sign the user in if they aren't already (anonymous, magic link, OAuth, etc. — whatever you enabled)
2. Use the Supabase JS SDK to load the authorization details for `authorization_id`
3. Render approve/deny UI
4. Submit the decision back to Supabase and redirect to the resulting URL

Follow Supabase's [OAuth Server — Getting Started guide](https://supabase.com/docs/guides/auth/oauth-server/getting-started) for the canonical implementation. See the [runnable example](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/mcp-use/examples/server/oauth/supabase) for a wired-up version (look at `auth-routes.ts`).

---

## User Context

Supabase populates these fields on `ctx.auth.user`:

| Field | Type | Source |
|-------|------|--------|
| `userId` | `string` | `sub` or `user_id` claim |
| `email` | `string?` | `email` claim |
| `name` | `string?` | `user_metadata.name` or `user_metadata.full_name` |
| `username` | `string?` | `user_metadata.username` |
| `picture` | `string?` | `user_metadata.avatar_url` |
| `roles` | `string[]?` | `role` claim (e.g. `["authenticated"]`) |
| `permissions` | `string[]?` | Derived from AAL (e.g. `["aal:aal1"]`) |
| `aal` | `string?` | Authentication Assurance Level |
| `amr` | `array?` | Authentication Methods References |
| `session_id` | `string?` | Supabase session ID |

---

## Making Supabase API Calls

Create a Supabase client scoped to the request using the user's access token so Row Level Security (RLS) policies see the caller as the authenticated user:

```typescript
import { createClient } from "@supabase/supabase-js";

server.tool(
  { name: "list-notes", description: "Fetch the user's notes" },
  async (_args, ctx) => {
    const supabase = createClient(
      `https://${process.env.MCP_USE_OAUTH_SUPABASE_PROJECT_ID}.supabase.co`,
      process.env.MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          headers: { Authorization: `Bearer ${ctx.auth.accessToken}` },
        },
      }
    );

    const { data, error: queryError } = await supabase.from("notes").select();
    if (queryError) return error(`Failed to fetch notes: ${queryError.message}`);

    return object({ notes: data ?? [] });
  }
);
```

**Key point:** The `Authorization` header uses the user's access token (for RLS); the publishable key is passed to `createClient` for SDK/API access.

---

## Example `.env`

```bash
# Required: Supabase project ID (Dashboard → Project Settings → General)
MCP_USE_OAUTH_SUPABASE_PROJECT_ID=your-project-id

# Recommended: Publishable key (Dashboard → Project Settings → API Keys)
# Used by the consent UI and by tools calling Supabase REST/APIs
MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

# Legacy HS256 projects only (Dashboard → Project Settings → JWT Settings)
# New projects use ES256 + JWKS — leave this unset
# MCP_USE_OAUTH_SUPABASE_JWT_SECRET=your-jwt-secret
```

---

## Next Steps

- **Auth overview** → [overview.md](overview.md)
- **WorkOS setup** → [workos.md](workos.md)
- **Auth0 setup** → [auth0.md](auth0.md)
- **Build tools** → [../server/tools.md](../server/tools.md)

# securitySchemes Example

Demonstrates tool-level `securitySchemes` ([SEP-1488](https://modelcontextprotocol.io/specification/draft/server/tools#security-schemes) / OpenAI Apps SDK) and the matching `authenticationRequired()` response helper.

Auth is wired up with [Supabase OAuth](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication). Supabase hosts `/authorize`, `/token`, `/register`, and `.well-known` discovery; this example hosts the consent screen and uses Supabase's **anonymous sign-in** so you can click one button and immediately have a real session.

## What you can test

Each tool advertises a different `securitySchemes` shape. The value lands as a top-level field on the Tool object in `tools/list`, so ChatGPT and other SEP-1488–aware clients know which sign-in UI (if any) to show before invoking the tool.

| Tool             | `securitySchemes`                                          | Behaviour                                                                                     |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `public_search`  | `[{ type: "noauth" }]`                                     | Always anonymous.                                                                             |
| `browse_catalog` | `[{ type: "noauth" }, { type: "oauth2", scopes: [...] }]` | Works signed-out; returns richer results when signed in.                                      |
| `create_doc`     | `[{ type: "oauth2", scopes: ["docs.write"] }]`            | Returns `authenticationRequired()` (with `_meta["mcp/www_authenticate"]`) when called anonymously. |
| `whoami`         | `[{ type: "oauth2", scopes: ["openid"] }]`                | Returns the live JWT claims — handy for confirming the anonymous flow worked.                 |

## Setup

1. **Configure Supabase** (one-time, in the dashboard):
   - **Authentication → OAuth Server**: set the consent screen URL to `http://localhost:3000/auth/consent`.
   - **Auth → Providers → Anonymous**: enable anonymous sign-ins.
2. **Set env vars** (see `.env.example`):
   ```bash
   cp .env.example .env
   # Fill in MCP_USE_OAUTH_SUPABASE_PROJECT_ID and MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY
   ```
3. **Run it**:
   ```bash
   pnpm install
   pnpm dev
   ```

Then open the MCP Inspector at <http://localhost:3000/inspector>.

## Walkthrough

1. **Hit `tools/list`** — every tool comes back with its `securitySchemes` field at the top level.
2. **Call `create_doc` without a token** — the result has `isError: true` and `_meta["mcp/www_authenticate"]` set to a `Bearer` challenge with the requested scopes and the `resource_metadata` URL. That's the SEP-1488 sign-in trigger ChatGPT-style clients look for.
3. **Run the Inspector's "Authorize" flow** — it discovers Supabase as the auth server, registers a client, Supabase redirects to `/auth/consent`, you click **Continue as guest** (anonymous sign-in), approve consent, and the Inspector receives an access token.
4. **Call `create_doc` and `whoami` again** — both now succeed. `whoami` echoes the JWT claims.

## Files

```
src/
  auth-routes.ts   Sign-in + consent pages backed by Supabase's anonymous auth and OAuth approval APIs
  server.ts        MCP server with four tools and the Supabase OAuth provider wired up
```

## Notes

- **Advertisement only.** `securitySchemes` does not enforce anything — the server still has to verify tokens (the OAuth provider does this at the transport layer) and the tool handler still has to gate behaviour on `ctx.auth`.
- Anonymous Supabase sessions are real Supabase sessions; they just skip account creation. You can link them to a real provider later via the Supabase SDK.
- See [`docs/typescript/server/tools.mdx`](../../../../../../../docs/typescript/server/tools.mdx) ("Advertising Authentication") for the full reference.

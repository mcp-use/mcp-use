# Sign-In Aware Tools Example

Demonstrates public, optional-auth, and auth-required MCP tools using tool-level `securitySchemes` ([SEP-1488](https://modelcontextprotocol.io/specification/draft/server/tools#security-schemes) / OpenAI Apps SDK) plus the matching `authenticationRequired()` response helper.

Auth is wired up with [WorkOS AuthKit](https://workos.com/docs/authkit/mcp). WorkOS handles Dynamic Client Registration, login, consent, and token issuance; this MCP server verifies the resulting bearer tokens and exposes the decoded claims on `ctx.auth`.

## What you can test

Each tool advertises a different `securitySchemes` shape. The value lands as a top-level field on the Tool object in `tools/list`, so ChatGPT and other SEP-1488–aware clients know which sign-in UI (if any) to show before invoking the tool.

| Tool             | `securitySchemes`                                          | Behaviour                                                                                         |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `public_search`  | `[{ type: "noauth" }]`                                     | Always anonymous.                                                                                 |
| `browse_catalog` | `[{ type: "noauth" }, { type: "oauth2", scopes: [...] }]` | Works signed-out; returns richer results when signed in.                                          |
| `create_doc`     | `[{ type: "oauth2", scopes: ["openid"] }]`                | Returns `authenticationRequired()` (with `_meta["mcp/www_authenticate"]`) when called anonymously. |
| `whoami`         | `[{ type: "oauth2", scopes: ["openid"] }]`                | Returns the live JWT claims, handy for confirming the anonymous flow worked.                      |

## Setup

1. **Set env vars** (required, see `.env.example`):
   ```bash
   cp .env.example .env
   # Set MCP_USE_OAUTH_WORKOS_SUBDOMAIN to your full AuthKit domain,
   # or mount a 1Password Environment that provides WORKOS_AUTH_KIT_URL.
   ```
2. **Run it**:
   ```bash
   pnpm install
   pnpm dev
   ```

Then open the MCP Inspector at <http://localhost:3000/inspector>.

## Walkthrough

1. **Hit `tools/list`** — every tool comes back with its `securitySchemes` field at the top level.
2. **Call `create_doc` without a token** — the result has `isError: true` and `_meta["mcp/www_authenticate"]` set to a `Bearer` challenge with the requested scopes and the `resource_metadata` URL. That's the SEP-1488 sign-in trigger ChatGPT-style clients look for.
3. **Run the Inspector's "Authorize" flow** — it discovers WorkOS as the auth server, dynamically registers a client, redirects to WorkOS AuthKit, and receives an access token after login and consent.
4. **Call `create_doc` and `whoami` again** — both now succeed. `whoami` echoes the JWT claims.

This demo uses the OIDC `openid` scope for every OAuth tool because WorkOS AuthKit advertises OIDC scopes (`openid`, `email`, `profile`, `offline_access`) by default. If your WorkOS environment is configured to issue custom API scopes, you can swap `openid` for scopes like `catalog.read` or `docs.write` in both `securitySchemes` and `authenticationRequired()`.

## Files

```
src/
  server.ts        MCP server with four tools and WorkOS OAuth wired up
```

## Notes

- **Advertisement only.** `securitySchemes` does not enforce anything — the server still has to verify tokens (the OAuth provider does this at the transport layer) and the tool handler still has to gate behaviour on `ctx.auth`.
- WorkOS Dynamic Client Registration must be enabled in the WorkOS Dashboard under **Connect -> Configuration**.
- Add each public MCP resource URI, including the `/mcp` path, under **Connect -> Configuration -> MCP resource indicators**.
- Add your MCP client's callback URL to WorkOS redirects if the authorize flow reports a redirect URI mismatch.
- See [`docs/typescript/server/tools.mdx`](../../../../../../../docs/typescript/server/tools.mdx) ("Advertising Authentication") for the full reference.

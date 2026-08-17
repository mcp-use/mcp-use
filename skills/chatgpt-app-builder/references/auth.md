# Authentication

## Choose an integration

Configure OAuth when a server must identify callers or authorize access by user, organization, role, scope, or permission.

- Use a built-in provider adapter when the identity provider supports the expected resource-server and Dynamic Client Registration flow.
- Use `oauthCustomProvider` from `mcp-use/oauth` for another compatible provider.
- Use the OAuth proxy and verifier helpers when the upstream authorization server uses preregistered credentials rather than Dynamic Client Registration.
- Inspect the installed adapter declarations and current provider documentation for required options and environment variables.

Import adapters from explicit subpaths:

```ts
import { MCPServer } from "mcp-use";
import { oauthAuth0Provider } from "mcp-use/oauth/auth0";

const server = new MCPServer({
  name: "secure-server",
  version: "1.0.0",
  oauth: oauthAuth0Provider({ domain: process.env.AUTH0_DOMAIN! }),
});
```

Validate configuration at startup in production instead of relying on non-null assertions.

## Use verified request identity

With OAuth configured, callbacks receive:

- `ctx.auth.user`: provider-normalized verified identity. Built-in users have `id`; optional fields vary.
- `ctx.auth.scopes`: grants from verified auth information.
- `ctx.auth.permissions`: provider-mapped application permissions.
- `ctx.auth.payload`: verified claims or introspection data.
- `ctx.auth.accessToken`: the bearer token, for intentional downstream delegation only.
- `ctx.auth.clientId`, `expiresAt`, and `resource` when available.

Authorize the specific action rather than checking only that a user exists:

```ts
async ({ documentId }, ctx) => {
  if (!ctx.auth.permissions.includes("documents:delete")) {
    return {
      isError: true,
      content: [{ type: "text", text: "Forbidden" }],
    };
  }

  await deleteOwnedDocument(documentId, ctx.auth.user.id);
  return { content: [{ type: "text", text: "Document deleted" }] };
};
```

Prefer normalized user fields. Read raw payload claims only when the provider does not map a required verified value.

## Security boundaries

- Never treat `ctx.client.user()`, locale, location, subject, conversation ID, or other request metadata as authenticated identity.
- Keep authorization next to sensitive operations or in narrowly scoped MCP middleware.
- Forward an access token only to the intended upstream resource and never log or return it.
- Do not include client secrets, tokens, full claims, or provider payloads in examples, logs, tool content, structured output, `_meta`, or View state.
- Keep multi-request state in a trusted external store. Use verified request state for sensitive elicitation flows; do not infer continuity from module globals or transport details.

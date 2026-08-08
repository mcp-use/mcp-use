# Authentication

## Choose the integration

- Use a provider adapter when the identity provider supports the expected OAuth/DCR flow.
- Use `oauthCustomProvider` from `mcp-use/oauth` for a custom DCR-capable provider.
- Use the OAuth proxy and verifier helpers from `mcp-use/oauth` when upstream credentials are pre-registered.

Import provider adapters from their explicit subpaths:

```ts
import { MCPServer } from "mcp-use";
import { oauthAuth0Provider } from "mcp-use/oauth/auth0";

const server = new MCPServer({
  name: "secure-server",
  version: "1.0.0",
  oauth: oauthAuth0Provider(),
});
```

Inspect the installed adapter's declarations for required environment variables and options. Never place client secrets, tokens, or full OAuth payloads in examples, logs, or tool output.

## Tool authorization

Read identity from the callback context and fail closed:

```ts
async ({ documentId }, ctx) => {
  if (!ctx.auth) {
    return {
      isError: true,
      content: [{ type: "text", text: "Authentication required" }],
    };
  }

  await deleteOwnedDocument(documentId, ctx.auth.user.userId);
  return { content: [{ type: "text", text: "Document deleted" }] };
};
```

Check scopes/permissions for the action, not only the presence of a user. Do not assume optional profile fields exist. Keep authorization checks next to sensitive operations or in narrowly scoped middleware.

## Continuity

Treat deterministic request keys as correlation aids, not proof of identity continuity. Elicitation or multi-request sensitive flows require verified request state supplied by the protocol/host. Never reconstruct sensitive continuity from module globals.

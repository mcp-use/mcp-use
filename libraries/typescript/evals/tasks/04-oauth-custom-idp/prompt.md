Build an MCP (Model Context Protocol) server using the mcp-use TypeScript SDK (the `mcp-use` npm package) that is protected by your company's OpenID Connect identity provider.

The IdP is already running; its configuration is provided via environment variables (set in your shell now, and set for the server wherever it runs — read them from the environment, never hardcode their values):

- `OAUTH_ISSUER` — the IdP's issuer URL
- `OAUTH_AUTH_ENDPOINT` — authorization endpoint
- `OAUTH_TOKEN_ENDPOINT` — token endpoint
- `OAUTH_JWKS_URL` — the IdP's JSON Web Key Set
- `OAUTH_AUDIENCE` — the audience your server must require in tokens

Requirements:

1. Authentication:
   - The MCP endpoint accepts only RS256 JWTs issued by this IdP: verify the token signature against the JWKS, and require the `iss` claim to equal `OAUTH_ISSUER` and the `aud` claim to equal `OAUTH_AUDIENCE`.
   - Requests with a missing, malformed, expired, or otherwise invalid bearer token must be rejected with HTTP status 401.
   - Tool handlers must read the authenticated user's identity from the server's auth layer (the verified request context) — do not hardcode any identity string inside a tool handler.
2. The server must expose exactly these two tools:
   - `whoami` — no parameters. Returns the authenticated user's user id (the token subject) as provided by the auth layer.
   - `add` — numeric parameters `a` and `b`. Returns their sum.
3. Tool input parameters must be validated with typed schemas.
4. The server must serve MCP over streamable HTTP, listening on the port given by the `PORT` environment variable (defaulting to 3000 when unset).
5. The server entry file must be `src/server.ts` or `index.ts`.
6. The project must be TypeScript: it must typecheck cleanly with `npx tsc --noEmit` and be runnable with `npx tsx <entry-file>`.
7. Install any dependencies you need so the project runs as-is.

When you are done, verify your work: typecheck the project, start the server, and confirm that requests without (or with an invalid) token are rejected with 401. The IdP supports the standard OAuth 2.0 authorization-code flow, so you can also obtain a real token from it and confirm that `whoami` and `add` behave correctly with it.

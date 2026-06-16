Build an MCP (Model Context Protocol) server using the mcp-use TypeScript SDK (the `mcp-use` npm package) whose endpoint is protected by Clerk sign-in.

A Clerk-compatible issuer for this app is already set up and running; its Frontend API URL is provided in the `MCP_USE_OAUTH_CLERK_FRONTEND_API_URL` environment variable (set in your shell now, and set for the server wherever it runs — read it from the environment, never hardcode the URL).

Requirements:

1. Authentication:
   - Use the SDK's Clerk OAuth provider: configure the server with `oauthClerkProvider()` from `mcp-use/server`. Do not hand-roll JWT/JWKS verification for this task, and do not use a generic custom OAuth provider.
   - Requests to the MCP endpoint must present a bearer token issued by the Clerk instance. Requests with a missing, malformed, or invalid `Authorization` header must be rejected with HTTP status 401.
   - Requests presenting a valid Clerk-issued token must work normally.
   - Tool handlers must read the authenticated user's identity from the server's auth layer (the verified request context) — do not hardcode any identity string inside a tool handler.
2. The server must expose exactly these two tools:
   - `whoami` — no parameters. Returns the authenticated user's user id (the token subject) as provided by the auth layer.
   - `add` — numeric parameters `a` and `b`. Returns their sum.
3. Tool input parameters must be validated with typed schemas.
4. The server must serve MCP over streamable HTTP, listening on the port given by the `PORT` environment variable (defaulting to 3000 when unset).
5. The server entry file must be `src/server.ts` or `index.ts`.
6. The project must be TypeScript: it must typecheck cleanly with `npx tsc --noEmit` and be runnable with `npx tsx <entry-file>`.
7. Install any dependencies you need so the project runs as-is.

When you are done, verify your work: typecheck the project, start the server, and confirm that requests without (or with an invalid) token are rejected with 401. The eval harness will grade the successful-auth path with a Clerk-issued JWT from the local issuer; you do not need to implement or mock Dynamic Client Registration in your server.

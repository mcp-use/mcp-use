Build an MCP (Model Context Protocol) server using the mcp-use TypeScript SDK (the `mcp-use` npm package) that requires bearer-token authentication.

Requirements:

1. Authentication:
   - The server accepts exactly one bearer token: the value of the `MCP_AUTH_TOKEN` environment variable (default to `dev-token` when the variable is unset).
   - Requests to the MCP endpoint with a missing, malformed, or wrong `Authorization` header must be rejected with HTTP status 401.
   - Requests presenting the accepted token as `Authorization: Bearer <token>` must work normally.
   - The bearer of the accepted token is the user `agent@example.com`. Tool handlers must read the authenticated user's identity from the server's auth layer (the verified request context) — do not hardcode the identity string inside a tool handler.
2. The server must expose exactly these two tools:
   - `whoami` — no parameters. Returns the authenticated user's identity; the response must include `agent@example.com`.
   - `add` — numeric parameters `a` and `b`. Returns their sum.
3. Tool input parameters must be validated with typed schemas.
4. The server must serve MCP over streamable HTTP, listening on the port given by the `PORT` environment variable (defaulting to 3000 when unset).
5. The server entry file must be `src/server.ts` or `index.ts`.
6. The project must be TypeScript: it must typecheck cleanly with `npx tsc --noEmit` and be runnable with `npx tsx <entry-file>`.
7. Install any dependencies you need so the project runs as-is.

When you are done, verify your work: typecheck the project, start the server, confirm that requests without (or with a wrong) token are rejected with 401, and confirm that with the valid token the `whoami` and `add` tools behave correctly.

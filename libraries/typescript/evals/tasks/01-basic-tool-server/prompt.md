Build an MCP (Model Context Protocol) server using the mcp-use TypeScript SDK (the `mcp-use` npm package).

Requirements:

1. The server must expose a single tool named `add` that takes two numeric parameters, `a` and `b`, and returns their sum.
2. The tool's input parameters must be validated with a typed schema.
3. The server must serve MCP over streamable HTTP, listening on the port given by the `PORT` environment variable (defaulting to 3000 when unset).
4. The server entry file must be `src/server.ts` or `index.ts`.
5. The project must be TypeScript: it must typecheck cleanly with `npx tsc --noEmit` and be runnable with `npx tsx <entry-file>`.
6. Install any dependencies you need so the project runs as-is.

When you are done, verify your work: typecheck the project, start the server, and confirm the `add` tool behaves correctly.

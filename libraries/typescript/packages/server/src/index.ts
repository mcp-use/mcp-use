/**
 * @mcp-use/server
 *
 * Server SDK for the mcp-use TypeScript framework.
 *
 * Provides everything you need to build an MCP server:
 * - MCPServer / createMCPServer — main server class
 * - OAuth providers and utilities
 * - Session stores (in-memory, filesystem, Redis)
 * - Response helpers (text, html, image, widget, etc.)
 * - Middleware utilities (CORS proxy, MCP operation middleware)
 * - Widget / MCP Apps adapters
 * - OpenAPI-to-MCP bridge
 * - Elicitation and completion helpers
 *
 * @example
 * ```ts
 * import { createMCPServer, text } from "@mcp-use/server";
 *
 * const server = createMCPServer({ name: "my-server", version: "1.0.0" });
 *
 * server.tool("greet", "Say hello", { name: z.string() }, async ({ name }) => {
 *   return text(`Hello, ${name}!`);
 * });
 *
 * await server.start({ port: 3000 });
 * ```
 */

export * from "./server/index.js";

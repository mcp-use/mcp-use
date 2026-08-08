import type { createServer as NodeCreateServer } from "node:http";

/**
 * Non-Node target for the internal conditional Node HTTP import.
 *
 * Fetch-based runtimes never call `listen()`. Keeping this as a runtime error
 * preserves a Node-free package graph for Workers and browser-oriented
 * bundlers while Node resolves the same internal specifier to `node:http`.
 */
export const createServer: typeof NodeCreateServer = () => {
  throw new Error("MCPServer.listen() requires a Node.js runtime");
};

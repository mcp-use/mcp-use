declare module "#mcp-use-node-http" {
  export const createServer: typeof import("node:http").createServer;
}

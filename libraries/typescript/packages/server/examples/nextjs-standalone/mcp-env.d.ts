// mcp-use generated env declaration
import "mcp-use/vite-client";

declare module "mcp-use/react" {
  interface Register {
    tools: typeof import("./src/mcp/server.js");
  }
}

export {};

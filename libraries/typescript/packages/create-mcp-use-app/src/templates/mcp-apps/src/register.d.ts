declare module "mcp-use/react" {
  interface Register {
    tools: typeof import("../index.js");
  }
}

export {};

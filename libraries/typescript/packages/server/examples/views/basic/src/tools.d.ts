declare module "@mcp-use/server/react" {
  interface Register {
    tools: typeof import("./index.js");
  }
}

export {};

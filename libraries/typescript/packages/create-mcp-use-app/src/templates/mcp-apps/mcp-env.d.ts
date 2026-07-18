// mcp-use typing shim — dev/build recreate this file if missing.
declare module "*.css";

declare module "mcp-use/react" {
  interface Register {
    tools: typeof import("./index.js");
  }
}

export {};

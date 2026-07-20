import type { NextConfig } from "next";
import { withMcpUse } from "mcp-use/next";

const nextConfig = {} satisfies NextConfig;

// The adapter builds views and configures their assets, tracing, and CORS.
export default withMcpUse(nextConfig, {
  entry: "./mcp-server.ts",
  basePath: "/api/mcp",
});

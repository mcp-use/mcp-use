#!/usr/bin/env node
// Keep the framework package as the public binary owner while the prebuilt
// implementation lives in @mcp-use/cli and can be budgeted independently.
declare const __MCP_USE_PACKAGE_VERSION__: string;

const { runBin } = await import("@mcp-use/cli");
runBin(process.argv.slice(2), {
  frameworkVersion: __MCP_USE_PACKAGE_VERSION__,
});

export {};

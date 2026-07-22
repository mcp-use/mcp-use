#!/usr/bin/env node
// Keep the framework package as the public binary owner while the prebuilt
// implementation lives in @mcp-use/cli and can be budgeted independently.
await import("@mcp-use/cli");
export {};

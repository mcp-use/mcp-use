// Browser stub for @modelcontextprotocol/sdk/client/stdio.
// The stdio transport is Node.js-only (uses child_process via cross-spawn).
// It is never used in browser contexts but gets pulled into the bundle through
// mcp-use's MCPClient which supports multiple transports.
export class StdioClientTransport {
  constructor() {
    throw new Error(
      "StdioClientTransport is not available in browser environments"
    );
  }
}

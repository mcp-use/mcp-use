/**
 * Helper for conformance test server URLs
 *
 * Note: You must start the conformance server manually before running tests:
 * cd packages/mcp-use/examples/server/features/conformance
 * pnpm build
 * pnpm start --port 3002
 */

export class ConformanceServerHelper {
  private port: number;

  constructor(port: number = 3002) {
    this.port = port;
  }

  /**
   * Get the base URL for the server
   */
  getBaseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  /**
   * Get the MCP endpoint URL
   */
  getMcpUrl(): string {
    return `http://localhost:${this.port}/mcp`;
  }

  /**
   * Get the server port
   */
  getPort(): number {
    return this.port;
  }
}

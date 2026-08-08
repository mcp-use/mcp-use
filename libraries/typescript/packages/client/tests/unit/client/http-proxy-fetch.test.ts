import { describe, expect, it, vi } from "vitest";
import { HttpConnector } from "../../../src/transport/http.js";

describe("HttpConnector MCP proxy fetch", () => {
  it("keeps the logical MCP URL while routing transport bytes to the proxy", async () => {
    const requests: Request[] = [];
    const baseFetch = vi.fn(async (input: RequestInfo | URL) => {
      requests.push(input as Request);
      return new Response("{}", { status: 200 });
    });
    const connector = new HttpConnector("https://mcp.example.com/mcp", {
      gatewayUrl: "https://inspector.example.com/inspector/api/proxy",
      serverId: "server-1",
      fetch: baseFetch,
    });

    await (connector as any).customFetch("https://mcp.example.com/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"jsonrpc":"2.0"}',
    });

    expect(requests[0].url).toBe(
      "https://inspector.example.com/inspector/api/proxy"
    );
    expect(requests[0].headers.get("X-Target-URL")).toBe(
      "https://mcp.example.com/mcp"
    );
    expect(requests[0].headers.get("X-Server-Id")).toBe("server-1");
  });

  it("does not route OAuth discovery through the MCP transport proxy", async () => {
    const requests: Request[] = [];
    const baseFetch = vi.fn(async (input: RequestInfo | URL) => {
      requests.push(input as Request);
      return new Response("{}", { status: 200 });
    });
    const connector = new HttpConnector("https://mcp.example.com/mcp", {
      gatewayUrl: "https://inspector.example.com/inspector/api/proxy",
      fetch: baseFetch,
    });
    const metadataUrl =
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp";

    await (connector as any).customFetch(metadataUrl);

    expect(requests[0].url).toBe(metadataUrl);
    expect(requests[0].headers.has("X-Target-URL")).toBe(false);
  });
});

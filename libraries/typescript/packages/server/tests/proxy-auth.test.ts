import { beforeEach, describe, expect, it, vi } from "vitest";

import { MCPServer } from "../src/index.js";

const clientState = vi.hoisted(() => ({
  configs: [] as Array<Record<string, unknown>>,
  closeCalls: 0,
  connectGate: undefined as Promise<void> | undefined,
  rejectCloseIndexes: new Set<number>(),
}));

vi.mock("@mcp-use/client", () => ({
  MCPClient: class MockMCPClient {
    readonly index: number;

    constructor(config: Record<string, unknown>) {
      this.index = clientState.configs.length;
      clientState.configs.push(config);
    }

    async connect() {
      await clientState.connectGate;
      return {
        info: { server: { name: "upstream" } },
        supports: () => false,
      };
    }

    async close() {
      clientState.closeCalls += 1;
      if (clientState.rejectCloseIndexes.has(this.index)) {
        throw new Error(`close ${this.index} failed`);
      }
    }
  },
}));

describe("server.proxy authentication", () => {
  beforeEach(() => {
    clientState.configs.length = 0;
    clientState.closeCalls = 0;
    clientState.connectGate = undefined;
    clientState.rejectCloseIndexes.clear();
  });

  it("forces client auto-OAuth off and never supplies browser options", async () => {
    const server = new MCPServer({ name: "parent", version: "1.0.0" });
    try {
      await server.proxy({
        upstream: {
          url: "https://upstream.example/mcp",
          headers: { Authorization: "Bearer caller-managed" },
        },
      });
      await server.listen(0);

      expect(clientState.configs).toEqual([
        {
          mcpServers: {
            upstream: {
              url: "https://upstream.example/mcp",
              headers: { Authorization: "Bearer caller-managed" },
              oauth: false,
            },
          },
        },
      ]);
      expect(JSON.stringify(clientState.configs)).not.toContain("openBrowser");
    } finally {
      await server.close();
    }
  });

  it("closes an owner created by proxy setup that overlaps shutdown", async () => {
    let releaseConnection!: () => void;
    clientState.connectGate = new Promise<void>((resolve) => {
      releaseConnection = resolve;
    });
    const server = new MCPServer({ name: "parent", version: "1.0.0" });

    const proxying = server.proxy({
      upstream: { url: "https://upstream.example/mcp" },
    });
    await vi.waitFor(() => expect(clientState.configs).toHaveLength(1));
    const closing = server.close();
    releaseConnection();

    await Promise.all([proxying, closing]);
    expect(clientState.closeCalls).toBe(1);
  });

  it("waits for every owned client close when one rejects", async () => {
    const server = new MCPServer({ name: "parent", version: "1.0.0" });
    await server.proxy({ first: { url: "https://first.example/mcp" } });
    await server.proxy({ second: { url: "https://second.example/mcp" } });
    clientState.rejectCloseIndexes.add(0);

    await expect(server.close()).rejects.toThrow(
      "Failed to close MCP server cleanly"
    );
    expect(clientState.closeCalls).toBe(2);
  });
});

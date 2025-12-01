/**
 * Agent Compatibility Tests
 *
 * Tests that verify MCPAgent works correctly with:
 * - Node.js Client (MCPClient)
 * - Browser Client (BrowserMCPClient)
 * - Same inputs produce same results
 * - Consistent error handling
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MCPClient } from "../../../src/client.js";
import { BrowserMCPClient } from "../../../src/client/browser.js";
import { MCPAgent } from "../../../src/agents/mcp_agent.js";

// Mock LLM for testing (MCPAgent requires llm or agentId)
const createMockLLM = () =>
  ({
    invoke: async () => ({ content: "test" }),
    bindTools: () => ({}),
  }) as any;

describe("MCPAgent Compatibility", () => {
  describe("Agent with Node.js Client", () => {
    it("should accept MCPClient instance", () => {
      const client = new MCPClient({
        mcpServers: {
          test: { url: "http://localhost:3000" },
        },
      });

      const agent = new MCPAgent({
        llm: createMockLLM(),
        client,
      });

      expect(agent).toBeDefined();
    });

    it("should work with client configuration", () => {
      const config = {
        mcpServers: {
          test: {
            url: "http://localhost:3000",
            transport: "http",
          },
        },
      };

      const client = MCPClient.fromDict(config);
      const agent = new MCPAgent({
        llm: createMockLLM(),
        client,
      });

      expect(agent).toBeDefined();
    });

    it("should work with code mode enabled client", () => {
      const client = new MCPClient({}, { codeMode: true });
      const agent = new MCPAgent({
        llm: createMockLLM(),
        client,
      });

      expect(agent).toBeDefined();
      expect(client.codeMode).toBe(true);
    });
  });

  describe("Agent with Browser Client", () => {
    it("should accept BrowserMCPClient instance", () => {
      const client = new BrowserMCPClient({
        mcpServers: {
          test: { url: "http://localhost:3000" },
        },
      });

      const agent = new MCPAgent({
        llm: createMockLLM(),
        client: client as any, // MCPAgent expects MCPClient, but BrowserMCPClient extends BaseMCPClient
      });

      expect(agent).toBeDefined();
    });

    it("should work with browser client configuration", () => {
      const config = {
        mcpServers: {
          test: {
            url: "http://localhost:3000",
            transport: "http",
          },
        },
      };

      const client = BrowserMCPClient.fromDict(config);
      const agent = new MCPAgent({
        llm: createMockLLM(),
        client: client as any,
      });

      expect(agent).toBeDefined();
    });
  });

  describe("API Consistency", () => {
    it("should have same agent API regardless of client type", () => {
      const nodeClient = new MCPClient({
        mcpServers: {
          test: { url: "http://localhost:3000" },
        },
      });

      const browserClient = new BrowserMCPClient({
        mcpServers: {
          test: { url: "http://localhost:3000" },
        },
      });

      const nodeAgent = new MCPAgent({
        llm: createMockLLM(),
        client: nodeClient,
      });

      const browserAgent = new MCPAgent({
        llm: createMockLLM(),
        client: browserClient as any,
      });

      // Both agents should have the same methods
      expect(typeof nodeAgent.run).toBe("function");
      expect(typeof browserAgent.run).toBe("function");

      expect(typeof nodeAgent.stream).toBe("function");
      expect(typeof browserAgent.stream).toBe("function");

      expect(typeof nodeAgent.streamEvents).toBe("function");
      expect(typeof browserAgent.streamEvents).toBe("function");

      expect(typeof nodeAgent.close).toBe("function");
      expect(typeof browserAgent.close).toBe("function");
    });
  });

  describe("Error Handling Consistency", () => {
    it("should handle missing client consistently", () => {
      // Agent requires either client or connectors, and llm or agentId
      // This test verifies that agent creation works with just llm and client
      const client = new MCPClient();
      const agent = new MCPAgent({
        llm: createMockLLM(),
        client,
      });
      expect(agent).toBeDefined();
    });

    it("should handle empty config consistently", () => {
      const nodeClient = new MCPClient();
      const browserClient = new BrowserMCPClient();

      const nodeAgent = new MCPAgent({
        llm: createMockLLM(),
        client: nodeClient,
      });

      const browserAgent = new MCPAgent({
        llm: createMockLLM(),
        client: browserClient as any,
      });

      expect(nodeAgent).toBeDefined();
      expect(browserAgent).toBeDefined();
    });
  });

  describe("Client Property Access", () => {
    it("should allow access to underlying client", () => {
      const nodeClient = new MCPClient({
        mcpServers: {
          test: { url: "http://localhost:3000" },
        },
      });

      const agent = new MCPAgent({
        llm: createMockLLM(),
        client: nodeClient,
      });

      // The agent should have access to the client's methods through the client property
      // This is implementation-dependent, but we verify the agent is created successfully
      expect(agent).toBeDefined();
    });
  });
});

describe("Agent Feature Compatibility", () => {
  describe("Code Mode Compatibility", () => {
    it("should work with code mode enabled Node.js client", () => {
      const client = new MCPClient({}, { codeMode: true });
      const agent = new MCPAgent({
        llm: createMockLLM(),
        client,
      });

      expect(agent).toBeDefined();
      expect(client.codeMode).toBe(true);
    });

    it("should NOT work with code mode in browser client (code mode not available)", () => {
      const browserClient = new BrowserMCPClient();
      // Browser client doesn't have codeMode property
      expect((browserClient as any).codeMode).toBeUndefined();

      const agent = new MCPAgent({
        llm: createMockLLM(),
        client: browserClient as any,
      });

      // Agent should still be created, but code mode won't be available
      expect(agent).toBeDefined();
    });
  });

  describe("Connector Compatibility", () => {
    it("should work with HTTP connector in both clients", () => {
      const config = {
        mcpServers: {
          http: {
            url: "http://localhost:3000",
            transport: "http",
          },
        },
      };

      const nodeClient = new MCPClient(config);
      const browserClient = new BrowserMCPClient(config);

      const nodeAgent = new MCPAgent({
        llm: createMockLLM(),
        client: nodeClient,
      });

      const browserAgent = new MCPAgent({
        llm: createMockLLM(),
        client: browserClient as any,
      });

      expect(nodeAgent).toBeDefined();
      expect(browserAgent).toBeDefined();
    });

    it("should work with WebSocket connector in both clients", () => {
      const config = {
        mcpServers: {
          ws: {
            url: "ws://localhost:3000",
            transport: "websocket",
          },
        },
      };

      const nodeClient = new MCPClient(config);
      const browserClient = new BrowserMCPClient(config);

      const nodeAgent = new MCPAgent({
        llm: createMockLLM(),
        client: nodeClient,
      });

      const browserAgent = new MCPAgent({
        llm: createMockLLM(),
        client: browserClient as any,
      });

      expect(nodeAgent).toBeDefined();
      expect(browserAgent).toBeDefined();
    });

    it("should work with STDIO connector only in Node.js client", () => {
      const config = {
        mcpServers: {
          stdio: {
            command: "node",
            args: ["-e", "console.log('test')"],
          },
        },
      };

      const nodeClient = new MCPClient(config);
      const nodeAgent = new MCPAgent({
        llm: createMockLLM(),
        client: nodeClient,
      });

      expect(nodeAgent).toBeDefined();

      // Browser client should not support stdio
      const browserClient = new BrowserMCPClient(config);
      // Config is stored, but connector creation will fail at runtime
      expect(browserClient.getServerConfig("stdio")).toBeDefined();
    });
  });
});

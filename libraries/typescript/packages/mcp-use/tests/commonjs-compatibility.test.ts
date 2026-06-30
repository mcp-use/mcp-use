/**
 * CommonJS Compatibility Test
 *
 * This test verifies that mcp-use works correctly when imported using CommonJS
 * require() syntax. This is important for projects that haven't migrated to ESM.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

describe("CommonJS Compatibility", () => {
  it("should import main exports from CommonJS bundle", () => {
    const mcpUse = require("../dist/index.cjs");

    expect(mcpUse).toBeDefined();
    expect(mcpUse.MCPClient).toBeDefined();
    expect(typeof mcpUse.MCPClient).toBe("function");
  });

  it("should import server subpath from CommonJS bundle", () => {
    const serverModule = require("../dist/src/server/index.cjs");

    expect(serverModule).toBeDefined();
    expect(serverModule.MCPServer).toBeDefined();
    expect(typeof serverModule.MCPServer).toBe("function");
  });

  it("should import react subpath from CommonJS bundle", () => {
    const reactModule = require("../dist/src/react/index.cjs");

    expect(reactModule).toBeDefined();
    // mcp-use/react is the view runtime; the useMcp console moved to
    // @mcp-use/client/react.
    expect(reactModule.useWidget).toBeDefined();
    expect(typeof reactModule.useWidget).toBe("function");
  });

  it("should import browser subpath from CommonJS bundle", () => {
    const browserModule = require("../dist/src/browser.cjs");

    expect(browserModule).toBeDefined();
    // Browser module should have exports
    expect(Object.keys(browserModule).length).toBeGreaterThan(0);
  });

  describe("MCPClient functionality with CommonJS", () => {
    let client: any;
    let MCPClient: any;

    beforeAll(async () => {
      const mcpUse = require("../dist/index.cjs");
      MCPClient = mcpUse.MCPClient;

      // Create client instance
      client = new MCPClient({
        mcpServers: {
          everything: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-everything"],
          },
        },
      });
      await client.createAllSessions();
    });

    afterAll(async () => {
      if (client) {
        await client.closeAllSessions();
      }
    });

    it("should create MCPClient instance", () => {
      expect(client).toBeDefined();
      // The class is re-exported through @mcp-use/client; esbuild's CJS bundling
      // may prefix the constructor name (e.g. "_MCPClient"), so match the suffix.
      expect(client.constructor.name).toMatch(/MCPClient$/);
    });

    it("should get session", () => {
      const session = client.getSession("everything");
      expect(session).toBeDefined();
    });

    it("should list tools", async () => {
      const session = client.getSession("everything");
      const tools = await session.listTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("should list resources", async () => {
      const session = client.getSession("everything");
      const resources = await session.listResources();
      // Resources might be empty or paginated, just check it returns something
      expect(resources).toBeDefined();
    });

    it("should call a tool", async () => {
      const session = client.getSession("everything");
      const tools = await session.listTools();

      // Find echo tool or similar simple tool
      const echoTool = tools.find((t: any) => t.name === "echo");
      if (echoTool) {
        const result = await session.callTool("echo", { message: "test" });
        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
      }
    });

    it("should properly clean up sessions", async () => {
      const session = client.getSession("everything");
      expect(session).toBeDefined();

      await client.closeAllSessions();

      // Sessions are closed but getSession might still return the object
      // Just verify we can call closeAllSessions without error
      expect(client).toBeDefined();
    });
  });

  describe("MCPServer functionality with CommonJS", () => {
    let MCPServer: any;

    beforeAll(() => {
      const serverModule = require("../dist/src/server/index.cjs");
      MCPServer = serverModule.MCPServer;
    });

    it("should create MCPServer instance", () => {
      const server = new MCPServer({
        name: "test-commonjs-server",
        version: "1.0.0",
      });

      expect(server).toBeDefined();
      // Constructor name might be MCPServerClass internally
      expect(server.constructor.name).toMatch(/MCPServer/);
    });

    it("should add tools to server", () => {
      const server = new MCPServer({
        name: "test-commonjs-server",
        version: "1.0.0",
      });

      server.tool(
        {
          name: "test-tool",
          description: "A test tool",
        },
        async () => {
          return { content: [{ type: "text", text: "test" }] };
        }
      );

      // Server should have the tool registered
      expect(server).toBeDefined();
    });

    it("should add resources to server", () => {
      const server = new MCPServer({
        name: "test-commonjs-server",
        version: "1.0.0",
      });

      server.resource(
        {
          name: "test-resource",
          uri: "text://test",
          description: "A test resource",
        },
        async () => {
          return {
            contents: [
              { uri: "test://resource", mimeType: "text/plain", text: "test" },
            ],
          };
        }
      );

      // Server should have the resource registered
      expect(server).toBeDefined();
    });

    it("should add prompts to server", () => {
      const server = new MCPServer({
        name: "test-commonjs-server",
        version: "1.0.0",
      });

      server.prompt(
        {
          name: "test-prompt",
          description: "A test prompt",
        },
        async () => {
          return {
            content: [{ type: "text", text: "test" }],
          };
        }
      );

      // Server should have the prompt registered
      expect(server).toBeDefined();
    });
  });

  describe("Package exports compatibility", () => {
    it("should have all main exports available in CommonJS", () => {
      const mcpUse = require("../dist/index.cjs");

      // Check that main exports are available
      const expectedExports = ["MCPClient"];

      for (const exportName of expectedExports) {
        expect(mcpUse[exportName]).toBeDefined();
        expect(typeof mcpUse[exportName]).toBe("function");
      }
    });

    it("should work with destructuring", () => {
      const { MCPClient } = require("../dist/index.cjs");

      expect(MCPClient).toBeDefined();
      expect(typeof MCPClient).toBe("function");
    });

    it("should work with default require", () => {
      const mcpUse = require("../dist/index.cjs");

      expect(mcpUse).toBeDefined();
      expect(typeof mcpUse).toBe("object");
      expect(Object.keys(mcpUse).length).toBeGreaterThan(0);
    });
  });
});

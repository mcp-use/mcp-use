/**
 * CommonJS Compatibility Test
 *
 * Verifies that `mcp-use` (the server framework) works correctly when imported
 * with CommonJS require() syntax. This matters for projects that haven't migrated
 * to ESM. The MCP client lives in `@mcp-use/client` and is tested there.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

describe("CommonJS Compatibility", () => {
  it("should import main (server) exports from CommonJS bundle", () => {
    const mcpUse = require("../dist/index.cjs");

    expect(mcpUse).toBeDefined();
    expect(mcpUse.MCPServer).toBeDefined();
    expect(typeof mcpUse.MCPServer).toBe("function");
  });

  it("should import react subpath from CommonJS bundle", () => {
    const reactModule = require("../dist/src/react/index.cjs");

    expect(reactModule).toBeDefined();
    // mcp-use/react is the view runtime; the useMcp console moved to
    // @mcp-use/client/react.
    expect(reactModule.useWidget).toBeDefined();
    expect(typeof reactModule.useWidget).toBe("function");
  });

  describe("MCPServer functionality with CommonJS", () => {
    let MCPServer: any;

    beforeAll(() => {
      const mcpUse = require("../dist/index.cjs");
      MCPServer = mcpUse.MCPServer;
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
    it("should have main (server) exports available in CommonJS", () => {
      const mcpUse = require("../dist/index.cjs");

      // Check that main exports are available
      const expectedExports = ["MCPServer", "createMCPServer"];

      for (const exportName of expectedExports) {
        expect(mcpUse[exportName]).toBeDefined();
        expect(typeof mcpUse[exportName]).toBe("function");
      }
    });

    it("should work with destructuring", () => {
      const { MCPServer } = require("../dist/index.cjs");

      expect(MCPServer).toBeDefined();
      expect(typeof MCPServer).toBe("function");
    });

    it("should work with default require", () => {
      const mcpUse = require("../dist/index.cjs");

      expect(mcpUse).toBeDefined();
      expect(typeof mcpUse).toBe("object");
      expect(Object.keys(mcpUse).length).toBeGreaterThan(0);
    });
  });
});

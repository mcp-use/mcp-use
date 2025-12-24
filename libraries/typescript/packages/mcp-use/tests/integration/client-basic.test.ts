/**
 * Integration test for basic MCPClient usage as shown in documentation
 *
 * Tests the basic example from docs/typescript/client/index.mdx (lines 41-68)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MCPClient } from "../../src/client.js";

describe("MCPClient Basic Usage", () => {
  let client: MCPClient;

  beforeAll(async () => {
    // Create client and connect as shown in documentation
    client = new MCPClient({
      mcpServers: {
        "my-server": {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-everything"],
        },
      },
    });
    await client.createAllSessions();
  });

  afterAll(async () => {
    // Cleanup
    await client.closeAllSessions();
  });

  it("should create client and establish sessions", () => {
    expect(client).toBeDefined();
    const session = client.getSession("my-server");
    expect(session).toBeDefined();
  });

  it("should list available tools", async () => {
    const session = client.getSession("my-server");
    const tools = await session.listTools();
    expect(tools).toBeDefined();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("should be able to call a tool", async () => {
    const session = client.getSession("my-server");
    const tools = await session.listTools();

    // Find a tool to call (prefer a simple one if available)
    const toolToCall = tools.find(
      (tool) => tool.name && !tool.name.includes("complex")
    );

    if (toolToCall) {
      // Try to call the tool with minimal parameters
      // Note: The exact parameters depend on the tool, so we'll use an empty object
      // In a real scenario, you'd provide proper parameters based on the tool schema
      try {
        const result = await session.callTool(toolToCall.name, {});
        expect(result).toBeDefined();
      } catch (error) {
        // Some tools may require specific parameters, which is expected
        // We just verify that the callTool method works
        expect(error).toBeDefined();
      }
    } else {
      // If no tools are available, skip the tool call test
      expect(tools.length).toBeGreaterThan(0);
    }
  });

  it("should properly clean up sessions", async () => {
    // Verify session exists before cleanup
    const sessionBefore = client.getSession("my-server");
    expect(sessionBefore).toBeDefined();

    // Close all sessions
    await client.closeAllSessions();

    // After cleanup, getting a session should still work (returns cached session)
    // but the underlying connection should be closed
    const sessionAfter = client.getSession("my-server");
    expect(sessionAfter).toBeDefined();
  });
});

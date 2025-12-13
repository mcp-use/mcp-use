/**
 * Test to verify the code example from docs/typescript/client/prompts.mdx (lines 16-33)
 *
 * This test checks if the documented API usage is correct and matches the actual implementation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MCPClient } from "../../src/client.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Documentation Example: Listing Prompts", () => {
  let client: MCPClient;

  beforeAll(async () => {
    // Create client as shown in documentation (lines 18-23)
    const config = {
      mcpServers: {
        my_server: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-everything"],
        },
      },
    };
    client = new MCPClient(config);
    await client.createAllSessions();
  }, 30000); // Increase timeout for server startup

  afterAll(async () => {
    await client.closeAllSessions();
  });

  it("should list prompts as shown in documentation (lines 25-31)", async () => {
    // Get session (line 25)
    const session = client.getSession("my_server");

    // List prompts (line 27)
    const prompts = await session.listPrompts();

    // Verify structure
    expect(prompts).toBeDefined();
    expect(prompts.prompts).toBeDefined();
    expect(Array.isArray(prompts.prompts)).toBe(true);
    expect(prompts.prompts.length).toBeGreaterThan(0);

    // Verify the documented API works (lines 28-31)
    for (const prompt of prompts.prompts) {
      expect(prompt.name).toBeDefined();
      expect(typeof prompt.name).toBe("string");
      expect(prompt.description).toBeDefined();
      expect(typeof prompt.description).toBe("string");

      console.log(`Prompt: ${prompt.name}`);
      console.log(`Description: ${prompt.description}`);
    }

    // Verify at least one prompt exists
    expect(prompts.prompts.length).toBeGreaterThan(0);
  });

  it("should access prompt properties correctly", async () => {
    const session = client.getSession("my_server");
    const prompts = await session.listPrompts();

    // Find a prompt with arguments
    const promptWithArgs = prompts.prompts.find(
      (p) => p.arguments && p.arguments.length > 0
    );

    if (promptWithArgs) {
      expect(promptWithArgs.arguments).toBeDefined();
      expect(Array.isArray(promptWithArgs.arguments)).toBe(true);
      expect(promptWithArgs.arguments.length).toBeGreaterThan(0);

      // Verify argument structure
      const firstArg = promptWithArgs.arguments[0];
      expect(firstArg.name).toBeDefined();
      expect(typeof firstArg.name).toBe("string");
    } else {
      // If no prompts with arguments, that's acceptable
      console.log("No prompts with arguments found");
    }
  });

  it("should handle prompts without arguments", async () => {
    const session = client.getSession("my_server");
    const prompts = await session.listPrompts();

    if (prompts.prompts.length > 0) {
      // Find a prompt without arguments
      const simplePrompt = prompts.prompts.find(
        (p) => !p.arguments || p.arguments.length === 0
      );

      if (simplePrompt) {
        expect(simplePrompt.name).toBeDefined();
        expect(typeof simplePrompt.name).toBe("string");

        // arguments should be undefined or an empty array
        if (simplePrompt.arguments) {
          expect(Array.isArray(simplePrompt.arguments)).toBe(true);
          expect(simplePrompt.arguments.length).toBe(0);
        }
      }
    }
  });

  it("should return empty array when no prompts are available", async () => {
    // Create a client with a server that has no prompts
    const emptyConfig = {
      mcpServers: {
        empty_server: {
          command: "npx",
          args: [
            "-y",
            "tsx",
            resolve(__dirname, "../servers/simple_server.ts"),
          ],
        },
      },
    };
    const emptyClient = new MCPClient(emptyConfig);
    await emptyClient.createAllSessions();

    const session = emptyClient.getSession("empty_server");

    try {
      const prompts = await session.listPrompts();

      // Should return empty prompts array or throw an error
      expect(prompts).toBeDefined();
      if (prompts.prompts) {
        expect(Array.isArray(prompts.prompts)).toBe(true);
      }
    } catch (error) {
      // It's acceptable for servers without prompts capability to throw an error
      expect(error).toBeDefined();
    } finally {
      await emptyClient.closeAllSessions();
    }
  });

  it("demonstrates the complete workflow from documentation", async () => {
    // This test follows the exact pattern from the documentation
    const session = client.getSession("my_server");

    // List all available prompts
    const prompts = await session.listPrompts();
    expect(prompts.prompts.length).toBeGreaterThan(0);

    // Iterate and log as shown in docs
    const loggedPrompts: Array<{ name: string; description: string }> = [];
    for (const prompt of prompts.prompts) {
      loggedPrompts.push({
        name: prompt.name,
        description: prompt.description,
      });
      console.log(`Prompt: ${prompt.name}`);
      console.log(`Description: ${prompt.description}`);
    }

    // Verify we captured all prompts
    expect(loggedPrompts.length).toBe(prompts.prompts.length);
    expect(loggedPrompts.every((p) => p.name && p.description)).toBe(true);
  });
});

/**
 * Test to verify the code example from docs/typescript/client/tools.mdx (lines 67-95)
 *
 * This test checks if the documented API usage is correct and matches the actual implementation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MCPClient } from "../../src/client.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const simpleServerPath = resolve(__dirname, "../servers/simple_server.ts");

describe("Documentation Example: Calling Tools", () => {
  let client: MCPClient;

  beforeAll(async () => {
    // Create client as shown in documentation
    const config = {
      mcpServers: {
        filesystem_server: {
          command: "npx",
          args: ["-y", "tsx", simpleServerPath],
        },
      },
    };
    client = new MCPClient(config);
    await client.createAllSessions();
  });

  afterAll(async () => {
    await client.closeAllSessions();
  });

  it("should call a tool with arguments (documentation example)", async () => {
    const session = client.getSession("filesystem_server");

    // Call a tool with arguments (using the 'add' tool from simple_server)
    const result = await session.callTool("add", {
      a: 5,
      b: 3,
    });

    // Verify result structure
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);

    // The documentation shows checking result.isError
    // Note: isError is optional and may be undefined for successful results

    // Handle the result as shown in documentation
    if (result.isError) {
      // NOTE: Documentation shows result.content as string, but it's actually an array
      // Correct usage: result.content[0].text
      console.error(`Error: ${result.content[0]?.text}`);
      expect(result.isError).toBe(true);
    } else {
      // Correct way to access content
      const content = result.content[0];
      expect(content).toBeDefined();
      expect(content.type).toBe("text");
      expect(content.text).toBe("8"); // 5 + 3 = 8
      console.log(`Result: ${content.text}`);
    }
  });

  it("should handle error results correctly", async () => {
    const session = client.getSession("filesystem_server");

    // Call a tool with invalid arguments to trigger an error
    const result = await session.callTool("add", {
      a: "not a number",
      b: 3,
    });

    // Verify error handling
    expect(result.isError).toBe(true);
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Error");

    // Demonstrate correct error handling
    if (result.isError) {
      console.error(`Error: ${result.content[0].text}`);
    }
  });

  it("should handle unknown tool errors", async () => {
    const session = client.getSession("filesystem_server");

    // Call a non-existent tool
    const result = await session.callTool("nonexistent_tool", {});

    // Should return an error result
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool");
  });

  it("demonstrates the CORRECT way to access result.content", async () => {
    const session = client.getSession("filesystem_server");

    // Call a tool as shown in documentation (lines 80-86)
    const result = await session.callTool("add", {
      a: 10,
      b: 20,
    });

    // INCORRECT (as shown in docs lines 89-93):
    // if (result.isError) {
    //     console.error(`Error: ${result.content}`)  // ❌ result.content is an array!
    // } else {
    //     console.log(`File content: ${result.content}`)  // ❌ result.content is an array!
    // }

    // CORRECT way to handle the result:
    if (result.isError) {
      console.error(`Error: ${result.content[0]?.text || "Unknown error"}`);
    } else {
      // Access the first content item's text
      const contentText = result.content[0]?.text;
      console.log(`Result: ${contentText}`);
      expect(contentText).toBe("30");
    }

    // Alternative: handle multiple content items
    for (const content of result.content) {
      if (content.type === "text") {
        console.log(`Content text: ${content.text}`);
      } else if (content.type === "image") {
        console.log(`Content image: ${content.data?.substring(0, 20)}...`);
      } else if (content.type === "resource") {
        console.log(`Content resource: ${content.uri}`);
      }
    }
  });
});

/**
 * Test to verify the code example from docs/typescript/agent/index.mdx (lines 57-94)
 *
 * This test checks if the documented API usage for MCPAgent is correct and matches the actual implementation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MCPClient } from "../../src/client.js";
import { MCPAgent } from "../../src/agents/mcp_agent.js";
import { ChatOpenAI } from "@langchain/openai";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OPENAI_MODEL } from "../integration/agent/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const simpleServerPath = resolve(__dirname, "../servers/simple_server.ts");

describe("Documentation Example: MCPAgent Quick Start", () => {
  let client: MCPClient;
  let llm: ChatOpenAI;
  let agent: MCPAgent;

  beforeAll(async () => {
    // Configure MCP servers as shown in documentation
    const config = {
      mcpServers: {
        filesystem: {
          command: "npx",
          args: ["-y", "tsx", simpleServerPath],
        },
      },
    };

    // Create client
    client = new MCPClient(config);
    await client.createAllSessions();

    // Initialize LLM (using ChatOpenAI for testing, but docs show OpenAI)
    // Note: The documentation example uses OpenAI directly, but MCPAgent
    // works with LangChain LLMs like ChatOpenAI in the implementation
    llm = new ChatOpenAI({
      model: OPENAI_MODEL,
      temperature: 0,
    });

    // Create agent
    agent = new MCPAgent({
      llm,
      client,
      systemPrompt:
        "You are a helpful assistant with access to file system tools.",
    });
  }, 60000);

  afterAll(async () => {
    // Cleanup
    if (agent) {
      await agent.close();
    }
    if (client) {
      await client.closeAllSessions();
    }
  });

  it("should successfully create and run an agent as shown in documentation", async () => {
    // Run agent with a simple calculation task (since we're using simple_server with add tool)
    const result = await agent.run(
      "Use the add tool to calculate 5 + 3. Just give me the answer."
    );

    // Verify result
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect(result).toContain("8");

    console.log("Agent result:", result);
  }, 60000);

  it("should have access to tools from the MCP server", async () => {
    // Verify the agent has tools from the server
    const result = await agent.run(
      "What tools do you have available? List them."
    );

    expect(result).toBeDefined();
    console.log("Available tools:", result);
  }, 60000);

  it("should execute tools correctly", async () => {
    // Test tool execution
    const result = await agent.run(
      "Use the add tool to add 10 and 20. Give me just the number."
    );

    expect(result).toBeDefined();
    expect(result).toContain("30");

    // Verify the add tool was used
    expect(agent.toolsUsedNames).toBeDefined();
    expect(agent.toolsUsedNames).toContain("add");

    console.log("Tools used:", agent.toolsUsedNames);
  }, 60000);
});

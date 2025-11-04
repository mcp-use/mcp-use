/**
 * End-to-end integration test for server manager.
 *
 * Tests the agent with custom server manager for dynamic tool management.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MCPAgent } from "../../../src/agents/mcp_agent.js";
import { MCPClient } from "../../../src/client.js";
import { logger } from "../../../src/logging.js";
import { OPENAI_MODEL } from "./constants.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Custom server manager for testing
class CustomServerManager {
  private _tools: DynamicStructuredTool[] = [];
  private _initialized = false;

  addTool(tool: DynamicStructuredTool): void {
    this._tools.push(tool);
  }

  async initialize(): Promise<void> {
    // Create the get_greeting_tool dynamically inside the manager
    const getGreetingTool = new DynamicStructuredTool({
      name: "get_greeting_tool",
      description: "Adds a greeting tool to the server manager",
      schema: z.object({}),
      func: async () => {
        const greetingTool = new DynamicStructuredTool({
          name: "greet",
          description: "Returns a greeting message",
          schema: z.object({
            name: z.string().default("World").describe("Name to greet"),
          }),
          func: async ({ name = "World" }) => {
            return `Hello, ${name}!`;
          },
        });

        this.addTool(greetingTool);
        return `Added greeting tool to server manager. Total tools: ${this.tools.length}`;
      },
    });

    this.addTool(getGreetingTool);
    this._initialized = true;
  }

  get tools(): DynamicStructuredTool[] {
    return [...this._tools];
  }

  hasToolChanges(currentToolNames: Set<string>): boolean {
    const newToolNames = new Set(this.tools.map((t) => t.name));
    return (
      newToolNames.size !== currentToolNames.size ||
      [...newToolNames].some((name) => !currentToolNames.has(name))
    );
  }
}

describe("server manager integration test", () => {
  it("should dynamically add tools through server manager", async () => {
    const serverPath = path.resolve(
      __dirname,
      "../../servers/simple_server.ts"
    );

    const config = {
      mcpServers: {
        simple: {
          command: "tsx",
          args: [serverPath],
        },
      },
    };

    const client = MCPClient.fromDict(config);
    const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 });
    const serverManager = new CustomServerManager();

    const agent = new MCPAgent({
      llm,
      client,
      useServerManager: true,
      serverManagerFactory: () => serverManager as any,
      maxSteps: 10,
    });

    try {
      logger.info("\n" + "=".repeat(80));
      logger.info("TEST: test_server_manager");
      logger.info("=".repeat(80));

      await agent.initialize();

      logger.info(
        `Initial server manager tools: ${serverManager.tools.map((t) => t.name).join(", ")}`
      );

      expect(serverManager.tools.length).toBe(1);
      expect(serverManager.tools[0].name).toBe("get_greeting_tool");

      const query =
        "Call get_greeting_tool to add the greeting tool, then use the greet tool to say hello to Alice";
      logger.info(`Query: ${query}`);

      const result = await agent.run(query);

      logger.info(`Result: ${result}`);
      logger.info(
        `Final server manager tools: ${serverManager.tools.map((t) => t.name).join(", ")}`
      );
      logger.info("=".repeat(80) + "\n");

      // Check that the server manager has at least 2 tools
      expect(serverManager.tools.length).toBeGreaterThanOrEqual(2);

      // Check that the greet tool was added
      const greetTool = serverManager.tools.find((t) => t.name === "greet");
      expect(greetTool).toBeDefined();

      // Check that the result contains the greeting
      expect(result.toLowerCase()).toContain("hello");
      expect(result.toLowerCase()).toContain("alice");

      // Check conversation history for tool usage
      const history = agent.getConversationHistory();
      const historyStr = JSON.stringify(history);

      expect(historyStr).toContain("get_greeting_tool");
      expect(historyStr).toContain("greet");
    } finally {
      await agent.close();
    }
  }, 60000);
});

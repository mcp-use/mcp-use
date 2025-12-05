/**
 * Integration test for agent memory with tool outputs.
 *
 * Tests that tool calls and tool outputs are properly stored in conversation memory.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import { MCPAgent } from "../../src/agents/mcp_agent.js";
import { MCPClient } from "../../src/client.js";
import { logger } from "../../src/logging.js";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

describe("MCPAgent Memory - Tool Outputs", () => {
  it("should include tool messages in conversation history after execution", async () => {
    // Skip test if API key is not available
    if (!process.env.OPENAI_API_KEY) {
      logger.warn("Skipping memory test: OPENAI_API_KEY must be set");
      return;
    }

    const serverPath = path.resolve(__dirname, "../servers/simple_server.ts");

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
    const agent = new MCPAgent({
      llm,
      client,
      maxSteps: 5,
      memoryEnabled: true,
    });

    try {
      const query = "Add 5 and 10 using the add tool";
      logger.info("\n" + "=".repeat(80));
      logger.info("TEST: memory with tool outputs");
      logger.info("=".repeat(80));
      logger.info(`Query: ${query}`);

      // Execute the agent
      const result = await agent.run(query);

      logger.info(`Result: ${result}`);
      logger.info(`Tools used: ${agent.toolsUsedNames}`);

      // Get conversation history
      const history = agent.getConversationHistory();

      logger.info(`History length: ${history.length}`);
      for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        logger.info(
          `  [${i}] ${msg.constructor.name}: ${JSON.stringify(msg).slice(0, 100)}...`
        );
      }

      // Verify history contains multiple messages (not just query and response)
      expect(history.length).toBeGreaterThan(2);

      // Verify we have a HumanMessage (the query)
      const humanMessages = history.filter(
        (msg) => msg instanceof HumanMessage
      );
      expect(humanMessages.length).toBeGreaterThan(0);

      // Verify we have AIMessages
      const aiMessages = history.filter((msg) => msg instanceof AIMessage);
      expect(aiMessages.length).toBeGreaterThan(0);

      // Verify we have ToolMessages (tool outputs)
      const toolMessages = history.filter((msg) => msg instanceof ToolMessage);
      expect(toolMessages.length).toBeGreaterThan(0);

      // Verify the result is correct
      expect(result.toLowerCase()).toContain("15");
      expect(agent.toolsUsedNames).toContain("add");

      logger.info("✅ Tool messages are correctly stored in history");
      logger.info("=".repeat(80) + "\n");
    } finally {
      await agent.close();
    }
  }, 60000);

  it("should preserve tool messages in multi-turn conversation", async () => {
    // Skip test if API key is not available
    if (!process.env.OPENAI_API_KEY) {
      logger.warn("Skipping memory test: OPENAI_API_KEY must be set");
      return;
    }

    const serverPath = path.resolve(__dirname, "../servers/simple_server.ts");

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
    const agent = new MCPAgent({
      llm,
      client,
      maxSteps: 5,
      memoryEnabled: true,
    });

    try {
      logger.info("\n" + "=".repeat(80));
      logger.info("TEST: multi-turn conversation with tool outputs");
      logger.info("=".repeat(80));

      // First query
      const query1 = "Add 3 and 7 using the add tool";
      logger.info(`Query 1: ${query1}`);
      const result1 = await agent.run(query1);
      logger.info(`Result 1: ${result1}`);

      // Get history after first query
      const historyAfterFirst = agent.getConversationHistory();
      const toolMessagesAfterFirst = historyAfterFirst.filter(
        (msg) => msg instanceof ToolMessage
      );
      logger.info(
        `History after query 1: ${historyAfterFirst.length} messages`
      );
      logger.info(`  Tool messages: ${toolMessagesAfterFirst.length}`);

      expect(toolMessagesAfterFirst.length).toBeGreaterThan(0);

      // Second query - agent should remember the previous tool execution
      const query2 = "What was the previous result?";
      logger.info(`Query 2: ${query2}`);
      const result2 = await agent.run(query2);
      logger.info(`Result 2: ${result2}`);

      // Get history after second query
      const historyAfterSecond = agent.getConversationHistory();
      const toolMessagesAfterSecond = historyAfterSecond.filter(
        (msg) => msg instanceof ToolMessage
      );
      logger.info(
        `History after query 2: ${historyAfterSecond.length} messages`
      );
      logger.info(`  Tool messages: ${toolMessagesAfterSecond.length}`);

      // History should have grown
      expect(historyAfterSecond.length).toBeGreaterThan(
        historyAfterFirst.length
      );

      // Tool messages from first query should still be there
      expect(toolMessagesAfterSecond.length).toBeGreaterThanOrEqual(
        toolMessagesAfterFirst.length
      );

      // The agent should be able to reference the previous result
      expect(result2.toLowerCase()).toContain("10");

      logger.info("✅ Multi-turn conversation preserves tool messages");
      logger.info("=".repeat(80) + "\n");
    } finally {
      await agent.close();
    }
  }, 60000);
});

/**
 * End-to-end integration test for agent.stream().
 *
 * Tests the agent.stream() method yielding incremental responses.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import type { AgentStep } from "langchain/agents";
import { describe, expect, it } from "vitest";
import { MCPAgent } from "../../../src/agents/mcp_agent.js";
import { MCPClient } from "../../../src/client.js";
import { logger } from "../../../src/logging.js";
import { OPENAI_MODEL } from "./constants.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("agent.stream() integration test", () => {
  it("should yield incremental responses", async () => {
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
    const agent = new MCPAgent({ llm, client, maxSteps: 5 });

    try {
      const query = "Add 10 and 20 using the add tool";
      logger.info("\n" + "=".repeat(80));
      logger.info("TEST: test_agent_stream");
      logger.info("=".repeat(80));
      logger.info(`Query: ${query}`);

      const chunks: AgentStep[] = [];
      for await (const chunk of agent.stream(query)) {
        chunks.push(chunk);
        logger.info(
          `Chunk ${chunks.length}: ${JSON.stringify(chunk, null, 2)}`
        );
      }

      logger.info(`\nTotal chunks: ${chunks.length}`);
      logger.info("=".repeat(80) + "\n");

      expect(chunks.length).toBeGreaterThan(0);

      // Check if we got tool calls in the chunks
      const toolCalls = chunks.filter((chunk) => chunk.action?.tool === "add");
      expect(toolCalls.length).toBeGreaterThan(0);

      // Check if the final result contains the expected answer
      const lastChunk = chunks[chunks.length - 1];
      const result = lastChunk.observation || "";

      // The result might be in the conversation history
      const history = agent.getConversationHistory();
      const allContent = history.map((m) => JSON.stringify(m)).join(" ");

      expect(allContent).toContain("30");
    } finally {
      await agent.close();
    }
  }, 60000);
});

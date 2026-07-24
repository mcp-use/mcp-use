/**
 * Integration test for LangChain agent memory with tool outputs.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import { MCPAgent } from "../../../src/langchain.js";
import { MCPClient } from "@mcp-use/client";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

describe.skipIf(!process.env.OPENAI_API_KEY)(
  "LangChain MCPAgent memory - tool outputs",
  () => {
    it("includes tool messages in conversation history after execution", async () => {
      const serverPath = path.resolve(
        __dirname,
        "../../servers/simple_server.ts"
      );

      const client = MCPClient.fromDict({
        mcpServers: {
          simple: { command: "tsx", args: [serverPath] },
        },
      });
      const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 });
      const agent = new MCPAgent({
        llm,
        client,
        maxSteps: 5,
        memoryEnabled: true,
        autoInitialize: true,
      });

      try {
        const result = await agent.run("Add 5 and 10 using the add tool");
        const history = agent.getConversationHistory();

        expect(history.length).toBeGreaterThan(2);
        expect(history.some((msg) => msg instanceof HumanMessage)).toBe(true);
        expect(history.some((msg) => msg instanceof AIMessage)).toBe(true);
        expect(history.some((msg) => msg instanceof ToolMessage)).toBe(true);
        expect(result.toLowerCase()).toContain("15");
        expect(agent.toolsUsedNames).toContain("add");
      } finally {
        await agent.close();
      }
    }, 60_000);

    it("preserves tool messages in multi-turn conversation", async () => {
      const serverPath = path.resolve(
        __dirname,
        "../../servers/simple_server.ts"
      );

      const client = MCPClient.fromDict({
        mcpServers: {
          simple: { command: "tsx", args: [serverPath] },
        },
      });
      const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 });
      const agent = new MCPAgent({
        llm,
        client,
        maxSteps: 5,
        memoryEnabled: true,
        autoInitialize: true,
      });

      try {
        await agent.run("Add 3 and 7 using the add tool");
        const historyAfterFirst = agent.getConversationHistory();
        const toolMessagesAfterFirst = historyAfterFirst.filter(
          (msg) => msg instanceof ToolMessage
        );
        expect(toolMessagesAfterFirst.length).toBeGreaterThan(0);

        const result2 = await agent.run("What was the previous result?");
        const historyAfterSecond = agent.getConversationHistory();

        expect(historyAfterSecond.length).toBeGreaterThan(
          historyAfterFirst.length
        );
        expect(result2.toLowerCase()).toContain("10");
      } finally {
        await agent.close();
      }
    }, 60_000);
  }
);

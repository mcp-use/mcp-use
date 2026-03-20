/**
 * End-to-end integration test for agent.streamEvents().
 *
 * Tests the agent.streamEvents() method yielding individual LangChain events
 * including chat model streaming, tool calls, and chain execution events.
 */

import { ChatOpenAI } from "@langchain/openai";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../../../index.js";
import { MCPAgent } from "../../../src/agents/mcp_agent.js";
import { MCPClient } from "../../../src/client.js";
import { logger } from "../../../src/logging.js";
import { OPENAI_MODEL } from "./constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("agent.streamEvents() integration test", () => {
  it("should yield individual LangChain events for streaming", async () => {
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
      logger.info("TEST: test_agent_stream_events");
      logger.info("=".repeat(80));
      logger.info(`Query: ${query}`);

      const events: StreamEvent[] = [];
      for await (const event of agent.streamEvents(query)) {
        events.push(event);
        logger.info(
          `Event ${events.length}: ${event.event} - ${event.name || "N/A"}`
        );
      }

      logger.info(`\nTotal events: ${events.length}`);
      logger.info("=".repeat(80) + "\n");

      // Verify we got events
      expect(events.length).toBeGreaterThan(0);

      // Check for expected event types
      const eventTypes = events.map((e) => e.event);

      // Should have chain start/end events
      expect(eventTypes).toContain("on_chain_start");
      expect(eventTypes).toContain("on_chain_end");

      // Check for tool events (add tool should be called)
      const toolStartEvents = events.filter((e) => e.event === "on_tool_start");
      const toolEndEvents = events.filter((e) => e.event === "on_tool_end");

      expect(toolStartEvents.length).toBeGreaterThan(0);
      expect(toolEndEvents.length).toBeGreaterThan(0);

      // Verify at least one tool call was for 'add'
      const addToolEvents = toolStartEvents.filter((e) => e.name === "add");
      expect(addToolEvents.length).toBeGreaterThan(0);

      // Verify we can see chat model streaming events
      const chatModelEvents = events.filter(
        (e) => e.event === "on_chat_model_stream"
      );
      expect(chatModelEvents.length).toBeGreaterThan(0);

      // Check the final result contains the expected answer
      const history = agent.getConversationHistory();
      const allContent = history.map((m) => JSON.stringify(m)).join(" ");
      expect(allContent).toContain("30");
    } finally {
      await agent.close();
    }
  }, 60000);

  it("should track token-level streaming", async () => {
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
      const query = "Add 5 and 15 using the add tool";
      logger.info("\n" + "=".repeat(80));
      logger.info("TEST: test_agent_stream_events - token streaming");
      logger.info("=".repeat(80));
      logger.info(`Query: ${query}`);

      const tokens: string[] = [];
      for await (const event of agent.streamEvents(query)) {
        if (
          event.event === "on_chat_model_stream" &&
          event.data?.chunk?.content
        ) {
          tokens.push(event.data.chunk.content);
          logger.info(`Token: "${event.data.chunk.content}"`);
        }
      }

      logger.info(`\nTotal tokens: ${tokens.length}`);
      logger.info("=".repeat(80) + "\n");

      // Should have received at least some token-level chunks
      expect(tokens.length).toBeGreaterThan(0);

      // Reconstruct the full message from tokens
      const fullMessage = tokens.join("");
      logger.info(`Reconstructed message: ${fullMessage}`);

      // The message should be non-empty
      expect(fullMessage.length).toBeGreaterThan(0);
    } finally {
      await agent.close();
    }
  }, 60000);

  it("should provide tool execution details in events", async () => {
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
      const query = "Use the add tool to calculate 100 + 200";
      logger.info("\n" + "=".repeat(80));
      logger.info("TEST: test_agent_stream_events - tool execution");
      logger.info("=".repeat(80));
      logger.info(`Query: ${query}`);

      const toolStartEvents: StreamEvent[] = [];
      const toolEndEvents: StreamEvent[] = [];

      for await (const event of agent.streamEvents(query)) {
        if (event.event === "on_tool_start") {
          toolStartEvents.push(event);
          logger.info(
            `Tool Start: ${event.name} - Input: ${JSON.stringify(event.data?.input)}`
          );
        }
        if (event.event === "on_tool_end") {
          toolEndEvents.push(event);
          logger.info(
            `Tool End: ${event.name} - Output: ${JSON.stringify(event.data?.output)}`
          );
        }
      }

      logger.info(`\nTool start events: ${toolStartEvents.length}`);
      logger.info(`Tool end events: ${toolEndEvents.length}`);
      logger.info("=".repeat(80) + "\n");

      // Should have tool events
      expect(toolStartEvents.length).toBeGreaterThan(0);
      expect(toolEndEvents.length).toBeGreaterThan(0);

      // Tool events should be balanced (every start has an end)
      expect(toolStartEvents.length).toBe(toolEndEvents.length);

      // At least one tool call should be for 'add'
      const addToolStart = toolStartEvents.find((e) => e.name === "add");
      expect(addToolStart).toBeDefined();

      // Tool should have input data
      if (addToolStart?.data?.input) {
        logger.info(
          `Add tool input: ${JSON.stringify(addToolStart.data.input)}`
        );
      }

      // Find corresponding tool end event
      const addToolEnd = toolEndEvents.find((e) => e.name === "add");
      expect(addToolEnd).toBeDefined();

      // Tool should have output
      if (addToolEnd?.data?.output) {
        logger.info(
          `Add tool output: ${JSON.stringify(addToolEnd.data.output)}`
        );
        // Output should contain the result "300"
        const outputStr = JSON.stringify(addToolEnd.data.output);
        expect(outputStr).toContain("300");
      }
    } finally {
      await agent.close();
    }
  }, 60000);

  it("should handle errors and cleanup properly", async () => {
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

    // Use an invalid API key to force an error
    const llm = new ChatOpenAI({
      model: OPENAI_MODEL,
      temperature: 0,
      apiKey: "invalid-key-12345",
      timeout: 5000, // Add 5 second timeout to fail fast
      maxRetries: 0, // Disable retries to fail immediately
    });

    const agent = new MCPAgent({ llm, client, maxSteps: 5 });

    try {
      logger.info("\n" + "=".repeat(80));
      logger.info("TEST: test_agent_stream_events - error handling");
      logger.info("=".repeat(80));

      // This should fail due to invalid API key
      const events: StreamEvent[] = [];
      let errorThrown = false;

      try {
        for await (const event of agent.streamEvents("test query")) {
          events.push(event);
        }
      } catch (error) {
        errorThrown = true;
        logger.info(
          `Expected error caught: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Should have thrown an error
      expect(errorThrown).toBe(true);

      logger.info("=".repeat(80) + "\n");
    } finally {
      // Cleanup should work even after error
      await agent.close();
    }
  }, 60000);

  it("should validate event structure", async () => {
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
      const query = "Add 7 and 8";
      logger.info("\n" + "=".repeat(80));
      logger.info("TEST: test_agent_stream_events - event structure");
      logger.info("=".repeat(80));
      logger.info(`Query: ${query}`);

      const events: StreamEvent[] = [];
      for await (const event of agent.streamEvents(query)) {
        events.push(event);

        // Every event should have required fields
        expect(event).toHaveProperty("event");
        expect(typeof event.event).toBe("string");

        // Events should have data property (even if empty/undefined)
        expect(event).toHaveProperty("data");

        // Name may or may not be present depending on event type
        if (event.name !== undefined) {
          expect(typeof event.name).toBe("string");
        }
      }

      logger.info(`\nValidated ${events.length} events`);
      logger.info("=".repeat(80) + "\n");

      expect(events.length).toBeGreaterThan(0);
    } finally {
      await agent.close();
    }
  }, 60000);
});

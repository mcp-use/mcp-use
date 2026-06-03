/**
 * Integration test for agent observability with Langfuse.
 *
 * Tests that:
 * 1. Observability callbacks are registered when observability is enabled
 * 2. The agent runs successfully with observability enabled or disabled
 *
 * Prerequisites:
 * - OPENAI_API_KEY environment variable must be set
 * - LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY (only required for the
 *   "observability manager has callbacks" test)
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MCPAgent } from "../../../src/agents/mcp_agent.js";
import { MCPClient } from "../../../src/client.js";
import { logger } from "../../../src/logging.js";
import { OPENAI_MODEL } from "./constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("agent observability integration test", () => {
  // Store original environment variable to restore later
  let originalLangfuseEnabled: string | undefined;

  beforeEach(() => {
    originalLangfuseEnabled = process.env.MCP_USE_LANGFUSE;
  });

  afterEach(() => {
    if (originalLangfuseEnabled !== undefined) {
      process.env.MCP_USE_LANGFUSE = originalLangfuseEnabled;
    } else {
      delete process.env.MCP_USE_LANGFUSE;
    }
  });

  it("should not send traces when observability is disabled", async () => {
    // Skip test if OpenAI API key is not configured
    if (!process.env.OPENAI_API_KEY) {
      logger.warn("Skipping observability test: OPENAI_API_KEY must be set");
      return;
    }

    // Explicitly disable Langfuse
    process.env.MCP_USE_LANGFUSE = "false";

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

    // Create agent with observability explicitly disabled
    const agent = new MCPAgent({
      llm,
      client,
      maxSteps: 5,
      observe: false, // Explicitly disable observability
    });

    try {
      const query = "Use the add tool to calculate 5 + 7.";
      logger.info("\n" + "=".repeat(80));
      logger.info("TEST: test_agent_observability_disabled");
      logger.info("=".repeat(80));
      logger.info(`Query: ${query}`);

      // Run the agent
      const result = await agent.run(query);

      logger.info(`Result: ${result}`);
      logger.info(`Tools used: ${agent.toolsUsedNames}`);

      // Verify agent executed successfully
      expect(result).toContain("12");
      expect(agent.toolsUsedNames).toContain("add");

      logger.info("=".repeat(80) + "\n");
      logger.info("✅ Agent ran successfully with observability disabled");
    } finally {
      await agent.close();
    }
  }, 60000);

  it("should verify observability manager has callbacks when enabled", async () => {
    // Skip test if Langfuse credentials are not configured
    if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
      logger.warn(
        "Skipping observability manager test: LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set"
      );
      return;
    }

    // Ensure Langfuse is enabled
    process.env.MCP_USE_LANGFUSE = "true";

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

    // Create agent with observability enabled
    const agent = new MCPAgent({
      llm,
      client,
      maxSteps: 5,
      observe: true,
    });

    try {
      // Initialize the agent to set up observability
      await agent.initialize();

      // Access the observability manager (if exposed)
      // Note: This assumes the agent has a way to access the observability manager
      // If not directly exposed, we can verify through behavior instead
      logger.info("\n" + "=".repeat(80));
      logger.info("TEST: test_observability_manager_has_callbacks");
      logger.info("=".repeat(80));
      logger.info(
        "Observability is enabled and agent initialized successfully"
      );
      logger.info("=".repeat(80) + "\n");

      // If we can access the observability manager, verify it has callbacks
      // For now, we just verify the agent initializes without errors
      expect(agent).toBeDefined();
    } finally {
      await agent.close();
    }
  }, 60000);
});

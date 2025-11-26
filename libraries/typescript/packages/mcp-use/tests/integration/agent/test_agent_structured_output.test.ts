/**
 * End-to-end integration test for agent structured output.
 *
 * Tests the agent returning structured output using Zod schemas.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MCPAgent } from "../../../src/agents/mcp_agent.js";
import { MCPClient } from "../../../src/client.js";
import { logger } from "../../../src/logging.js";
import { OPENAI_MODEL } from "./constants.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("agent structured output integration test", () => {
  it("should return structured output using Zod schemas", async () => {
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

    // Define the output schema
    const CalculationResult = z.object({
      first_number: z.number().describe("The first number in the calculation"),
      second_number: z
        .number()
        .describe("The second number in the calculation"),
      result: z.number().describe("The result of the calculation"),
      operation: z
        .string()
        .describe('The operation performed (e.g., "addition")'),
    });

    type CalculationResultType = z.infer<typeof CalculationResult>;

    const client = MCPClient.fromDict(config);
    const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 });
    const agent = new MCPAgent({ llm, client, maxSteps: 5 });

    try {
      const query = "Add 15 and 25 using the add tool";
      logger.info("\n" + "=".repeat(80));
      logger.info("TEST: test_agent_structured_output");
      logger.info("=".repeat(80));
      logger.info(`Query: ${query}`);
      logger.info(`Output schema: CalculationResult`);

      const result = await agent.run<CalculationResultType>(
        query,
        undefined,
        undefined,
        undefined,
        CalculationResult
      );

      logger.info("\nStructured result:");
      logger.info(`  first_number: ${result.first_number}`);
      logger.info(`  second_number: ${result.second_number}`);
      logger.info(`  result: ${result.result}`);
      logger.info(`  operation: ${result.operation}`);
      logger.info("=".repeat(80) + "\n");

      // Type assertion to check if result is the correct type
      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("first_number");
      expect(result).toHaveProperty("second_number");
      expect(result).toHaveProperty("result");
      expect(result).toHaveProperty("operation");

      // Validate the values
      expect(result.result).toBe(40);
      expect(result.first_number).toBe(15);
      expect(result.second_number).toBe(25);
      expect(result.operation.toLowerCase()).toContain("add");

      // Validate against the schema
      const validated = CalculationResult.parse(result);
      expect(validated).toEqual(result);
    } finally {
      await agent.close();
    }
  }, 60000);
});

/**
 * Regression: native MCPAgent + OpenAI Responses API + HTTP mcpServers config.
 *
 * Guards:
 * - explicit `llm: ProviderConfig` + `mcpServers: { url }` spawns MCPClient and loads tools
 * - OpenAI provider omits `reasoning.effort` unless `reasoningEffort` is set (gpt-4o-mini)
 *
 * Requires OPENAI_API_KEY (set in GitHub Actions secrets).
 */
import { describe, expect, it } from "vitest";
import { MCPAgent, providerConfigFromOptions } from "../../../src/index.js";
import { AGENT_E2E_MCP_URL, OPENAI_NATIVE_E2E_MODEL } from "./constants.js";

describe.skipIf(!process.env.OPENAI_API_KEY)(
  "MCPAgent native OpenAI + HTTP mcpServers",
  () => {
    it("calls a remote MCP tool and summarizes the result", async () => {
      const agent = new MCPAgent({
        llm: providerConfigFromOptions("openai", OPENAI_NATIVE_E2E_MODEL, {
          apiKey: process.env.OPENAI_API_KEY!,
          temperature: 0,
        }),
        mcpServers: {
          analytics: { url: AGENT_E2E_MCP_URL },
        },
        maxSteps: 10,
        autoInitialize: true,
      });

      try {
        const result = await agent.run({
          prompt:
            "Use the get-metrics tool with empty arguments, then summarize the key numbers in 2-3 sentences.",
          maxSteps: 10,
        });

        expect(typeof result).toBe("string");
        expect(result).toMatch(
          /totalUsers|activeUsers|revenue|24,?580|24580|metrics/i
        );
      } finally {
        await agent.close();
      }
    }, 90_000);
  }
);

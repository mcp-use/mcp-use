/**
 * Verifies the simplified native MCPAgent quick start from docs/typescript/agent/index.mdx.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MCPAgent } from "../../src/agents/mcp_agent.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OPENAI_MODEL } from "../integration/agent/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const simpleServerPath = resolve(__dirname, "../servers/simple_server.ts");

describe.skipIf(!process.env.OPENAI_API_KEY)(
  "Documentation Example: MCPAgent Quick Start",
  () => {
    let agent: MCPAgent;

    beforeAll(async () => {
      agent = new MCPAgent({
        llm: `openai/${OPENAI_MODEL}`,
        mcpServers: {
          simple: {
            command: "tsx",
            args: [simpleServerPath],
          },
        },
        maxSteps: 10,
      });
    }, 60000);

    afterAll(async () => {
      if (agent) {
        await agent.close();
      }
    });

    it("should run a tool call as shown in documentation", async () => {
      const result = await agent.run({
        prompt: "Use the add tool to calculate 5 + 3. Just give me the answer.",
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result).toContain("8");
    }, 60000);
  }
);

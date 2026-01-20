import { describe, expect, it, vi } from "vitest";
import { createExploratoryTestPlan } from "../../../src/generator/createPlannerAgent.js";
import type { ServerSchema } from "../../../src/generator/inspectServers.js";
import { PlannerError } from "../../../src/shared/errors.js";

describe("createPlannerAgent", () => {
  it("throws error if server not found in config", async () => {
    const schema: ServerSchema = {
      name: "nonexistent",
      tools: [],
      resources: [],
    };

    await expect(
      createExploratoryTestPlan(schema, "./eval.config.json", {
        provider: "openai",
        model: "gpt-4o-mini",
      })
    ).rejects.toThrow(PlannerError);
  });

  it("validates schema structure", () => {
    const schema: ServerSchema = {
      name: "test",
      tools: [
        {
          name: "test_tool",
          description: "A test tool",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ],
      resources: [],
    };

    expect(schema.tools).toHaveLength(1);
    expect(schema.tools[0].name).toBe("test_tool");
  });
});

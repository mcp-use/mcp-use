import { describe, expect, it } from "vitest";
import { TestPlanSchema } from "../../../src/generator/planSchema.js";

describe("TestPlanSchema", () => {
  it("accepts a valid tool and resource plan", () => {
    const result = TestPlanSchema.safeParse({
      server: "weather",
      tools: [
        {
          name: "get_weather",
          tests: [
            { category: "direct", prompt: "Weather in Tokyo" },
            {
              category: "error",
              prompt: "Weather in ???",
              expectFailure: true,
            },
          ],
        },
      ],
      resources: [
        {
          name: "dashboard",
          tests: [{ category: "direct", prompt: "Show dashboard" }],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid resource categories", () => {
    const result = TestPlanSchema.safeParse({
      server: "weather",
      tools: [],
      resources: [
        {
          name: "dashboard",
          tests: [{ category: "error", prompt: "Bad category" }],
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

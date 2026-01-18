import { describe, expect, it } from "vitest";
import {
  extractPlannerJson,
  validatePlan,
} from "../../../src/generator/planValidation.js";

describe("plan validation", () => {
  it("extracts JSON from fenced blocks", () => {
    const content = '```json\n{"tools":[],"resources":[]}\n```';
    const data = extractPlannerJson(content);
    const plan = validatePlan(data);
    expect(plan.tools).toEqual([]);
    expect(plan.resources).toEqual([]);
  });

  it("rejects invalid JSON content", () => {
    expect(() => extractPlannerJson("not json")).toThrow();
  });
});

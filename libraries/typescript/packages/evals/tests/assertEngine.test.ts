import { describe, expect, it } from "vitest";
import { matchArgs, matchWidgetFields } from "../src/argMatchers.js";
import { evalJsonPath } from "../src/jsonPath.js";

describe("argMatchers", () => {
  it("matches exact and contains args", () => {
    expect(matchArgs({ query: "mango" }, { query: "mango" })).toBe(true);
    expect(matchArgs({ query: { contains: "man" } }, { query: "mango" })).toBe(true);
    expect(matchArgs({ query: "apple" }, { query: "mango" })).toBe(false);
  });

  it("matches widget fields", () => {
    const r = matchWidgetFields({ query: "mango" }, { query: "mango", results: [] });
    expect(r.passed).toBe(true);
  });
});

describe("jsonPath", () => {
  it("reads nested paths", () => {
    const obj = { structuredContent: { results: [{ fruit: "mango" }] } };
    expect(evalJsonPath(obj, "$.structuredContent.results[0].fruit")).toBe("mango");
  });

  it("reads root path", () => {
    expect(evalJsonPath([1, 2], "$")).toEqual([1, 2]);
  });
});

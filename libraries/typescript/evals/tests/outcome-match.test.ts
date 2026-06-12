import { describe, expect, it } from "vitest";
import { flattenCallResult, matchExpectation } from "../src/graders/outcome.js";

describe("matchExpectation", () => {
  it("contains: substring match", () => {
    expect(
      matchExpectation("The result is 5.", { type: "contains", value: "5" })
    ).toBe(true);
    expect(matchExpectation("nope", { type: "contains", value: "5" })).toBe(
      false
    );
  });

  it("not-contains: passes only when the substring is absent", () => {
    expect(
      matchExpectation("Workout", { type: "not-contains", value: "Groceries" })
    ).toBe(true);
    expect(
      matchExpectation("Groceries, Workout", {
        type: "not-contains",
        value: "Groceries",
      })
    ).toBe(false);
  });

  it("number-equals: matches a bare number", () => {
    expect(matchExpectation("5", { type: "number-equals", value: 5 })).toBe(
      true
    );
  });

  it("number-equals: tolerates prose around the number", () => {
    expect(
      matchExpectation("The sum of 2 and 3 is 5", {
        type: "number-equals",
        value: 5,
      })
    ).toBe(true);
  });

  it("number-equals: handles negatives and decimals", () => {
    expect(
      matchExpectation("-2.5", { type: "number-equals", value: -2.5 })
    ).toBe(true);
    expect(
      matchExpectation("Result: -2.5", { type: "number-equals", value: -2.5 })
    ).toBe(true);
  });

  it("number-equals: does not pass on a different number", () => {
    expect(matchExpectation("6", { type: "number-equals", value: 5 })).toBe(
      false
    );
  });

  it("number-equals: fails when no number present", () => {
    expect(matchExpectation("five", { type: "number-equals", value: 5 })).toBe(
      false
    );
  });
});

describe("flattenCallResult", () => {
  it("joins text content blocks", () => {
    expect(
      flattenCallResult({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      })
    ).toBe("a b");
  });

  it("includes structuredContent", () => {
    expect(
      flattenCallResult({ content: [], structuredContent: { sum: 5 } })
    ).toContain('"sum":5');
  });

  it("ignores non-text blocks", () => {
    expect(flattenCallResult({ content: [{ type: "image", data: "…" }] })).toBe(
      ""
    );
  });
});

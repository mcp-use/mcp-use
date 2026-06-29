import { describe, it, expect } from "vitest";
import { view, text } from "../../../src/server/utils/response-helpers.js";

describe("widget() helper", () => {
  it("should return basic widget response structure with props", () => {
    const result = view({
      props: { foo: "bar" },
    });

    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("structuredContent");
    expect(result.structuredContent).toEqual({ foo: "bar" });
  });

  it("should store props in structuredContent", () => {
    const testData = { foo: "bar", baz: 123 };
    const result = view({
      props: testData,
    });

    expect(result.structuredContent).toEqual(testData);
  });

  it("should use empty content when no message or output provided", () => {
    const result = view({
      props: { foo: "bar" },
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "",
    });
  });

  it("should use custom message when provided", () => {
    const result = view({
      props: { foo: "bar" },
      message: "Custom message",
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Custom message",
    });
  });

  it("should use output.content when provided without message", () => {
    const result = view({
      props: { foo: "bar" },
      output: text("Output from text helper"),
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Output from text helper",
    });
  });

  it("should prefer message over output.content", () => {
    const result = view({
      props: { foo: "bar" },
      output: text("This should be ignored"),
      message: "Custom message takes priority",
    });

    expect(result.content[0].text).toBe("Custom message takes priority");
  });

  it("should set _meta only when metadata config is provided", () => {
    const result = view({
      props: { foo: "bar" },
      metadata: { customField: "custom value" },
    });

    expect(result._meta).toEqual({ customField: "custom value" });
    expect(result.structuredContent).toEqual({ foo: "bar" });
  });

  it("should pass props through in structuredContent when no output", () => {
    const testData = {
      foo: "bar",
      nested: {
        value: 123,
      },
      array: [1, 2, 3],
    };

    const result = view({
      props: testData,
    });

    expect(result.structuredContent).toEqual(testData);
  });

  it("should use output.structuredContent when provided", () => {
    const outputData = { outputKey: "outputValue" };
    const result = view({
      props: { foo: "bar" },
      output: {
        content: [{ type: "text" as const, text: "Test" }],
        structuredContent: outputData,
      },
    });

    expect(result.structuredContent).toEqual(outputData);
  });

  it("should handle output without structuredContent", () => {
    const result = view({
      props: { foo: "bar" },
      output: text("Just text output"),
    });

    expect(result.structuredContent).toEqual({ foo: "bar" });
  });

  it("should not create _meta with minimal config and no metadata", () => {
    const result = view({
      props: {},
    });

    expect(result._meta).toBeUndefined();
  });

  it("should handle empty props", () => {
    const result = view({
      props: {},
      message: "Test",
    });

    expect(result._meta).toBeUndefined();
    expect(result.structuredContent).toBeUndefined();
  });
});

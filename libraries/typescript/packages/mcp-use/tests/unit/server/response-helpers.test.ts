import { describe, it, expect } from "vitest";
import { widget, text } from "../../../src/server/utils/response-helpers.js";

describe("widget() helper", () => {
  it("should return basic widget response structure with data", () => {
    const result = widget({
      data: { foo: "bar" },
    });

    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("structuredContent");
    expect(result.structuredContent).toEqual({ foo: "bar" });
  });

  it("should store data in structuredContent", () => {
    const testData = { foo: "bar", baz: 123 };
    const result = widget({
      data: testData,
    });

    expect(result.structuredContent).toEqual(testData);
  });

  it("should support props field as primary API", () => {
    const testData = { foo: "bar" };
    const result = widget({
      props: testData,
    });

    expect(result.structuredContent).toEqual(testData);
  });

  it("should prefer props over data when both provided", () => {
    const result = widget({
      props: { from: "props" },
      data: { from: "data" },
    });

    expect(result.structuredContent).toEqual({ from: "props" });
  });

  it("should use empty content when no message or output provided", () => {
    const result = widget({
      data: { foo: "bar" },
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "",
    });
  });

  it("should use custom message when provided", () => {
    const result = widget({
      data: { foo: "bar" },
      message: "Custom message",
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Custom message",
    });
  });

  it("should use output.content when provided without message", () => {
    const result = widget({
      data: { foo: "bar" },
      output: text("Output from text helper"),
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Output from text helper",
    });
  });

  it("should prefer message over output.content", () => {
    const result = widget({
      data: { foo: "bar" },
      output: text("This should be ignored"),
      message: "Custom message takes priority",
    });

    expect(result.content[0].text).toBe("Custom message takes priority");
  });

  it("should set _meta only when metadata config is provided", () => {
    const result = widget({
      data: { foo: "bar" },
      metadata: { customField: "custom value" },
    });

    expect(result._meta).toEqual({ customField: "custom value" });
    expect(result.structuredContent).toEqual({ foo: "bar" });
  });

  it("should pass data through in structuredContent when no output", () => {
    const testData = {
      foo: "bar",
      nested: {
        value: 123,
      },
      array: [1, 2, 3],
    };

    const result = widget({
      data: testData,
    });

    expect(result.structuredContent).toEqual(testData);
  });

  it("should use output.structuredContent when provided", () => {
    const outputData = { outputKey: "outputValue" };
    const result = widget({
      data: { foo: "bar" },
      output: {
        content: [{ type: "text" as const, text: "Test" }],
        structuredContent: outputData,
      },
    });

    expect(result.structuredContent).toEqual(outputData);
  });

  it("should handle output without structuredContent", () => {
    const result = widget({
      data: { foo: "bar" },
      output: text("Just text output"),
    });

    // When output has no structuredContent, use data as structuredContent
    expect(result.structuredContent).toEqual({ foo: "bar" });
  });

  it("should not create _meta with minimal config and no metadata", () => {
    const result = widget({
      data: {},
    });

    expect(result._meta).toBeUndefined();
  });

  it("should handle empty props/data", () => {
    const result = widget({
      props: {},
      message: "Test",
    });

    expect(result._meta).toBeUndefined();
    expect(result.structuredContent).toBeUndefined();
  });
});

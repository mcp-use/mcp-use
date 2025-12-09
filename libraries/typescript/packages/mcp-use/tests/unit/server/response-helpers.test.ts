import { describe, it, expect } from "vitest";
import { widget } from "../../../src/server/utils/response-helpers.js";

describe("widget() helper", () => {
  it("should return basic widget response structure", () => {
    const result = widget({
      name: "test-widget",
      data: { foo: "bar" },
    });

    expect(result).toHaveProperty("_meta");
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("structuredContent");
  });

  it("should generate URI with random ID pattern", () => {
    const result = widget({
      name: "test-widget",
      data: { foo: "bar" },
    });

    const uri = result._meta?.["openai/outputTemplate"] as string;
    expect(uri).toMatch(/^ui:\/\/widget\/test-widget-[a-z0-9]+\.html$/);
  });

  it("should include buildId in URI when provided", () => {
    const result = widget({
      name: "test-widget",
      data: { foo: "bar" },
      buildId: "abc123",
    });

    const uri = result._meta?.["openai/outputTemplate"] as string;
    expect(uri).toMatch(/^ui:\/\/widget\/test-widget-abc123-[a-z0-9]+\.html$/);
  });

  it("should use default message when not provided", () => {
    const result = widget({
      name: "test-widget",
      data: { foo: "bar" },
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Displaying test-widget",
    });
  });

  it("should use custom message when provided", () => {
    const result = widget({
      name: "test-widget",
      data: { foo: "bar" },
      message: "Custom message",
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Custom message",
    });
  });

  it("should include invoking status when provided", () => {
    const result = widget({
      name: "test-widget",
      data: { foo: "bar" },
      invoking: "Loading data...",
    });

    expect(result._meta?.["openai/toolInvocation/invoking"]).toBe(
      "Loading data..."
    );
  });

  it("should include invoked status when provided", () => {
    const result = widget({
      name: "test-widget",
      data: { foo: "bar" },
      invoked: "Data loaded",
    });

    expect(result._meta?.["openai/toolInvocation/invoked"]).toBe("Data loaded");
  });

  it("should set widgetAccessible to true by default", () => {
    const result = widget({
      name: "test-widget",
      data: { foo: "bar" },
    });

    expect(result._meta?.["openai/widgetAccessible"]).toBe(true);
  });

  it("should allow overriding widgetAccessible", () => {
    const result = widget({
      name: "test-widget",
      data: { foo: "bar" },
      widgetAccessible: false,
    });

    expect(result._meta?.["openai/widgetAccessible"]).toBe(false);
  });

  it("should set resultCanProduceWidget to true by default", () => {
    const result = widget({
      name: "test-widget",
      data: { foo: "bar" },
    });

    expect(result._meta?.["openai/resultCanProduceWidget"]).toBe(true);
  });

  it("should allow overriding resultCanProduceWidget", () => {
    const result = widget({
      name: "test-widget",
      data: { foo: "bar" },
      resultCanProduceWidget: false,
    });

    expect(result._meta?.["openai/resultCanProduceWidget"]).toBe(false);
  });

  it("should pass data through in structuredContent", () => {
    const testData = {
      foo: "bar",
      nested: {
        value: 123,
      },
      array: [1, 2, 3],
    };

    const result = widget({
      name: "test-widget",
      data: testData,
    });

    expect(result.structuredContent).toEqual(testData);
  });

  it("should include all metadata fields", () => {
    const result = widget({
      name: "test-widget",
      data: { foo: "bar" },
      message: "Test message",
      invoking: "Loading...",
      invoked: "Loaded",
      widgetAccessible: false,
      resultCanProduceWidget: false,
      buildId: "build123",
    });

    expect(result._meta).toMatchObject({
      "openai/widgetAccessible": false,
      "openai/resultCanProduceWidget": false,
      "openai/toolInvocation/invoking": "Loading...",
      "openai/toolInvocation/invoked": "Loaded",
    });
    expect(result._meta?.["openai/outputTemplate"]).toMatch(
      /^ui:\/\/widget\/test-widget-build123-[a-z0-9]+\.html$/
    );
  });

  it("should generate unique URIs on each call", () => {
    const result1 = widget({
      name: "test-widget",
      data: { foo: "bar" },
    });

    const result2 = widget({
      name: "test-widget",
      data: { foo: "bar" },
    });

    const uri1 = result1._meta?.["openai/outputTemplate"];
    const uri2 = result2._meta?.["openai/outputTemplate"];

    expect(uri1).not.toBe(uri2);
  });
});

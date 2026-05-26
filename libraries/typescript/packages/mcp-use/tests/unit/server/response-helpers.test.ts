import { describe, it, expect } from "vitest";
import {
  widget,
  text,
  authenticationRequired,
} from "../../../src/server/utils/response-helpers.js";

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

describe("authenticationRequired() helper", () => {
  const getChallenges = (
    result: ReturnType<typeof authenticationRequired>
  ): string[] => {
    const meta = result._meta as
      | { "mcp/www_authenticate"?: string[] }
      | undefined;
    const challenges = meta?.["mcp/www_authenticate"];
    if (!challenges) throw new Error("Expected mcp/www_authenticate challenge");
    return challenges;
  };

  it("defaults to invalid_token when no error is supplied", () => {
    const result = authenticationRequired();

    expect(result.isError).toBe(true);
    expect(result._meta).toBeDefined();
    const challenges = getChallenges(result);
    expect(Array.isArray(challenges)).toBe(true);
    expect(challenges[0]).toContain('error="invalid_token"');
    expect(challenges[0]).toContain('error_description="Authentication required"');
    expect(challenges[0].startsWith("Bearer ")).toBe(true);
  });

  it("uses the message override for the visible content", () => {
    const result = authenticationRequired({
      message: "Please sign in",
      errorDescription: "Login needed",
    });

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "Please sign in",
    });
    // Description still flows into the WWW-Authenticate challenge
    expect(getChallenges(result)[0]).toContain(
      'error_description="Login needed"'
    );
  });

  it("falls back to errorDescription when no message is supplied", () => {
    const result = authenticationRequired({
      errorDescription: "Login needed",
    });

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "Login needed",
    });
  });

  it("includes resource_metadata and scope when provided", () => {
    const result = authenticationRequired({
      resourceMetadataUrl: "https://example.com/.well-known/oauth-protected-resource",
      scopes: ["docs.write", "user.read"],
      error: "invalid_token",
      errorDescription: "Token expired",
    });

    const challenge = getChallenges(result)[0];
    expect(challenge).toContain(
      'resource_metadata="https://example.com/.well-known/oauth-protected-resource"'
    );
    expect(challenge).toContain('scope="docs.write user.read"');
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain('error_description="Token expired"');
  });

  it("omits the scope parameter when scopes is empty", () => {
    const result = authenticationRequired({ scopes: [] });

    const challenge = getChallenges(result)[0];
    expect(challenge).not.toContain("scope=");
  });
});

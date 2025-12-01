import { describe, it, expect } from "vitest";
import { assert } from "../../../src/utils/assert.js";

describe("assert", () => {
  it("should not throw when condition is true", () => {
    expect(() => assert(true, "Should not throw")).not.toThrow();
  });

  it("should not throw when condition is truthy", () => {
    expect(() => assert(1, "Should not throw")).not.toThrow();
    expect(() => assert("test", "Should not throw")).not.toThrow();
    expect(() => assert({}, "Should not throw")).not.toThrow();
    expect(() => assert([], "Should not throw")).not.toThrow();
  });

  it("should throw Error with message when condition is false", () => {
    expect(() => assert(false, "Test error message")).toThrow("Test error message");
    expect(() => assert(false, "Test error message")).toThrow(Error);
  });

  it("should throw Error with message when condition is falsy", () => {
    expect(() => assert(0, "Zero is falsy")).toThrow("Zero is falsy");
    expect(() => assert("", "Empty string is falsy")).toThrow("Empty string is falsy");
    expect(() => assert(null, "Null is falsy")).toThrow("Null is falsy");
    expect(() => assert(undefined, "Undefined is falsy")).toThrow("Undefined is falsy");
    expect(() => assert(NaN, "NaN is falsy")).toThrow("NaN is falsy");
  });

  it("should narrow types correctly when condition is true", () => {
    const value: string | null = "test";
    assert(value !== null, "Value should not be null");
    // TypeScript should narrow type here - value is now string
    const length: number = value.length;
    expect(length).toBe(4);
  });

  it("should work with type guards", () => {
    const value: unknown = "test";
    assert(typeof value === "string", "Value should be string");
    // TypeScript should narrow type here - value is now string
    const upper: string = value.toUpperCase();
    expect(upper).toBe("TEST");
  });

  it("should work with array checks", () => {
    const value: unknown[] | null = [1, 2, 3];
    assert(value !== null, "Array should not be null");
    assert(value.length > 0, "Array should not be empty");
    // TypeScript should narrow type here
    const first: number = value[0];
    expect(first).toBe(1);
  });

  it("should work with object property checks", () => {
    const obj: { prop?: string } = { prop: "value" };
    assert(obj.prop !== undefined, "Property should exist");
    // TypeScript should narrow type here
    const prop: string = obj.prop;
    expect(prop).toBe("value");
  });
});

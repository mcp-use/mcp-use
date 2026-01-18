import { describe, it, expect } from "vitest";
import { escapeString, truncate } from "../../../src/generator/escape.js";

describe("escapeString", () => {
  it("should escape double quotes", () => {
    const input = 'He said "hello"';
    const expected = 'He said \\"hello\\"';
    expect(escapeString(input)).toBe(expected);
  });

  it("should escape backslashes", () => {
    const input = "C:\\Users\\path";
    const expected = "C:\\\\Users\\\\path";
    expect(escapeString(input)).toBe(expected);
  });

  it("should escape newlines", () => {
    const input = "Line 1\nLine 2";
    const expected = "Line 1\\nLine 2";
    expect(escapeString(input)).toBe(expected);
  });

  it("should escape tabs", () => {
    const input = "Column1\tColumn2";
    const expected = "Column1\\tColumn2";
    expect(escapeString(input)).toBe(expected);
  });

  it("should escape carriage returns", () => {
    const input = "Line 1\rLine 2";
    const expected = "Line 1\\rLine 2";
    expect(escapeString(input)).toBe(expected);
  });

  it("should handle empty string", () => {
    expect(escapeString("")).toBe("");
  });

  it("should handle string with no special characters", () => {
    const input = "Hello, World!";
    expect(escapeString(input)).toBe(input);
  });

  it("should handle multiple escape sequences", () => {
    const input = 'He said "hello"\nAnd then "goodbye"';
    const expected = 'He said \\"hello\\"\\nAnd then \\"goodbye\\"';
    expect(escapeString(input)).toBe(expected);
  });

  it("should escape template literals (backticks)", () => {
    const input = "Use `backticks` for code";
    const expected = "Use \\`backticks\\` for code";
    expect(escapeString(input)).toBe(expected);
  });

  it("should escape dollar signs", () => {
    const input = "Price: $100";
    const expected = "Price: \\$100";
    expect(escapeString(input)).toBe(expected);
  });

  it("should escape single quotes", () => {
    const input = "It's a test";
    const expected = "It\\'s a test";
    expect(escapeString(input)).toBe(expected);
  });

  it("should handle JSON-like strings", () => {
    const input = '{"name": "John", "age": 30}';
    const expected = '{\\"name\\": \\"John\\", \\"age\\": 30}';
    expect(escapeString(input)).toBe(expected);
  });

  it("should handle mixed escapes", () => {
    const input = 'Path: C:\\Users\\John\nName: "John Doe"\tAge: 30';
    const expected =
      'Path: C:\\\\Users\\\\John\\nName: \\"John Doe\\"\\tAge: 30';
    expect(escapeString(input)).toBe(expected);
  });

  it("should escape all special characters together", () => {
    // eslint-disable-next-line no-template-curly-in-string
    const input = "`${\"test\"}` with 'quotes' and\nnewlines";
    // eslint-disable-next-line no-template-curly-in-string
    const expected = "\\`\\${\\\"test\\\"}\\` with \\'quotes\\' and\\nnewlines";
    expect(escapeString(input)).toBe(expected);
  });
});

describe("truncate", () => {
  it("should not truncate short strings", () => {
    const input = "Short string";
    expect(truncate(input, 50)).toBe(input);
  });

  it("should truncate long strings", () => {
    const input = "This is a very long string that needs truncation";
    const result = truncate(input, 20);

    expect(result.length).toBe(20);
    expect(result.endsWith("...")).toBe(true);
  });

  it("should handle exact length strings", () => {
    const input = "Exact";
    expect(truncate(input, 5)).toBe("Exact");
  });

  it("should handle empty strings", () => {
    expect(truncate("", 10)).toBe("");
  });

  it("should handle maxLength smaller than 3", () => {
    const input = "Test";
    const result = truncate(input, 2);

    // Should return first 2 characters without exceeding maxLength
    expect(result).toBe("Te");
    expect(result.length).toBe(2);
  });

  it("should preserve first characters when truncating", () => {
    const input = "ABCDEFGHIJ";
    const result = truncate(input, 8);

    expect(result.startsWith("ABCDE")).toBe(true);
    expect(result.endsWith("...")).toBe(true);
    expect(result.length).toBe(8);
  });

  it("should handle maxLength of 3", () => {
    const input = "Test";
    const result = truncate(input, 3);

    expect(result).toBe("...");
  });

  it("should handle maxLength of 4", () => {
    const input = "Testing";
    const result = truncate(input, 4);

    expect(result).toBe("T...");
    expect(result.length).toBe(4);
  });

  it("should handle very long strings", () => {
    const input = "A".repeat(1000);
    const result = truncate(input, 100);

    expect(result.length).toBe(100);
    expect(result.endsWith("...")).toBe(true);
    expect(result.startsWith("AAA")).toBe(true);
  });
});

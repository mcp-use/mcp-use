import { describe, it, expect } from "vitest";
import { EvalConfigError } from "./errors.js";

describe("EvalConfigError", () => {
  it("should create error with message", () => {
    const error = new EvalConfigError("Config is invalid");
    
    expect(error.message).toBe("Config is invalid");
    expect(error.name).toBe("EvalConfigError");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EvalConfigError);
  });

  it("should capture stack trace", () => {
    const error = new EvalConfigError("Test error");
    
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("EvalConfigError");
  });

  it("should work with instanceof checks", () => {
    const error = new EvalConfigError("Test");
    const genericError = new Error("Test");
    
    expect(error instanceof EvalConfigError).toBe(true);
    expect(error instanceof Error).toBe(true);
    expect(genericError instanceof EvalConfigError).toBe(false);
  });

  it("should handle empty message", () => {
    const error = new EvalConfigError("");
    
    expect(error.message).toBe("");
    expect(error.name).toBe("EvalConfigError");
  });

  it("should handle long messages", () => {
    const longMessage = "A".repeat(1000);
    const error = new EvalConfigError(longMessage);
    
    expect(error.message).toBe(longMessage);
    expect(error.message.length).toBe(1000);
  });

  it("should be catchable in try-catch", () => {
    expect(() => {
      throw new EvalConfigError("Test error");
    }).toThrow(EvalConfigError);
    
    expect(() => {
      throw new EvalConfigError("Test error");
    }).toThrow("Test error");
  });

  it("should be identifiable in catch block", () => {
    try {
      throw new EvalConfigError("Config error");
    } catch (error) {
      expect(error).toBeInstanceOf(EvalConfigError);
      if (error instanceof EvalConfigError) {
        expect(error.message).toBe("Config error");
      }
    }
  });
});

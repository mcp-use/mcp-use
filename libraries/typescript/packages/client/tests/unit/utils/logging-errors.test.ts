import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../../src/utils/logging.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logger Error arguments", () => {
  it("preserves errors created in another JavaScript realm", () => {
    const output = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error: Error = runInNewContext('new Error("Cross-realm failure")');
    expect(error).not.toBeInstanceOf(Error);

    logger.warn("Request failed:", error);

    expect(output).toHaveBeenCalledWith(
      expect.stringContaining("Error: Cross-realm failure")
    );
    expect(output).toHaveBeenCalledWith(expect.stringContaining(error.stack!));
  });

  it("falls back to the error message if reading its stack throws", () => {
    const output = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("Connection closed");
    Object.defineProperty(error, "stack", {
      get() {
        throw new Error("Stack formatter failed");
      },
    });

    expect(() => logger.warn("Request failed:", error)).not.toThrow();
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining("Error: Connection closed")
    );
  });

  it.each(["warn", "error"] as const)(
    "preserves an error's message and stack at %s level",
    (level) => {
      const output = vi.spyOn(console, level).mockImplementation(() => {});
      const error = new TypeError("Connection closed");

      logger[level]("Failed to refresh tools:", error);

      expect(output).toHaveBeenCalledWith(
        expect.stringContaining("TypeError: Connection closed")
      );
      expect(output).toHaveBeenCalledWith(
        expect.stringContaining(error.stack!)
      );
    }
  );

  it("keeps the error name and message when no stack is available", () => {
    const output = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("Connection closed");
    error.stack = undefined;

    logger.warn("Failed to refresh tools:", error);

    expect(output).toHaveBeenCalledWith(
      expect.stringContaining("Error: Connection closed")
    );
  });

  it("keeps the error type when its message and stack are empty", () => {
    const output = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new TypeError();
    error.stack = undefined;

    logger.warn("Failed to refresh tools:", error);

    expect(output).toHaveBeenCalledWith(
      expect.stringContaining("Failed to refresh tools: TypeError")
    );
  });

  it("preserves string and ordinary-object arguments", () => {
    const output = vi.spyOn(console, "warn").mockImplementation(() => {});

    logger.warn("Request failed:", "tools/list", { code: -32601 });

    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('Request failed: tools/list {"code":-32601}')
    );
  });
});

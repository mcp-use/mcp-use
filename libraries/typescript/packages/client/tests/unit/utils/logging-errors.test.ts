import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../../src/utils/logging.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logger Error arguments", () => {
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

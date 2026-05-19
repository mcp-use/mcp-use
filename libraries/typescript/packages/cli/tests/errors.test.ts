import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiUnauthorizedError } from "../src/utils/api.js";
import { handleCommandError } from "../src/utils/errors.js";

// Mock chalk so output is plain strings. Covers the exact chains used by
// handleCommandError (chalk.red, chalk.red.bold, chalk.gray, chalk.white).
vi.mock("chalk", () => {
  const id = (s: string) => s;
  const red: any = Object.assign((s: string) => s, { bold: id });
  return { default: { red, gray: id, white: id } };
});

describe("handleCommandError", () => {
  let consoleLog: string[];
  let consoleErr: string[];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    consoleLog = [];
    consoleErr = [];
    originalLog = console.log;
    originalError = console.error;
    originalExit = process.exit;

    console.log = vi.fn((...args) => {
      consoleLog.push(args.join(" "));
    });
    console.error = vi.fn((...args) => {
      consoleErr.push(args.join(" "));
    });
    // Throw instead of exiting so control flow stops at the first
    // `process.exit(...)` (and test assertions can still run).
    process.exit = vi.fn((code?: number) => {
      throw new Error(`__process_exit__${code ?? 0}`);
    }) as unknown as typeof process.exit;
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  });

  it("prints the re-auth hint for ApiUnauthorizedError and exits 1", () => {
    expect(() =>
      handleCommandError(new ApiUnauthorizedError(), "Failed to list servers")
    ).toThrow("__process_exit__1");

    expect(consoleErr.join("\n")).toContain(
      "Your session has expired or your API key is invalid."
    );
    expect(consoleErr.join("\n")).toContain("npx mcp-use login");
    expect(consoleErr.join("\n")).toContain("re-authenticate");
    // Should NOT show the generic "Failed to list servers" label for 401s.
    expect(consoleErr.join("\n")).not.toContain("Failed to list servers");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("prints the context label for non-401 errors and exits 1", () => {
    expect(() =>
      handleCommandError(
        new Error("connection refused"),
        "Failed to list servers"
      )
    ).toThrow("__process_exit__1");

    expect(consoleErr.join("\n")).toContain("Failed to list servers");
    expect(consoleErr.join("\n")).toContain("connection refused");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("handles non-Error thrown values", () => {
    expect(() => handleCommandError("oops", "Failed to do thing")).toThrow(
      "__process_exit__1"
    );

    expect(consoleErr.join("\n")).toContain("Failed to do thing");
    expect(consoleErr.join("\n")).toContain("Unknown error");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

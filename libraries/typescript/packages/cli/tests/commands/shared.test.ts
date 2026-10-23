import { parseArgs } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CommandError,
  CommandUsageError,
  reportError,
  UsageError,
} from "../../src/commands/shared.js";

afterEach(() => vi.restoreAllMocks());

function caughtError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to throw.");
}

describe("command error classification", () => {
  it.each([
    ["unknown option", () => parseArgs({ args: ["--unknown"] })],
    [
      "missing option value",
      () =>
        parseArgs({ args: ["--name"], options: { name: { type: "string" } } }),
    ],
    [
      "boolean option value",
      () =>
        parseArgs({
          args: ["--json=false"],
          options: { json: { type: "boolean" } },
        }),
    ],
    ["unexpected positional", () => parseArgs({ args: ["unexpected"] })],
  ])("reports native %s errors as usage errors", (_name, run) => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const error = caughtError(run);

    expect(reportError(error, true)).toBe(2);
    expect(JSON.parse(String(stderr.mock.calls[0]![0]))).toMatchObject({
      error: { code: "usage_error" },
    });
  });

  it("treats URL errors outside argument validation as operational failures", () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const error = caughtError(() => new URL("invalid remote resource"));

    expect(reportError(error, true)).toBe(1);
    expect(JSON.parse(String(stderr.mock.calls[0]![0]))).toMatchObject({
      error: { code: "command_failed" },
    });
  });

  it.each([
    [new TypeError("fetch failed"), 1, "command_failed"],
    [new TypeError("Unexpected response shape"), 1, "command_failed"],
    [new Error("ERR_PARSE_ARGS_UNKNOWN_OPTION"), 1, "command_failed"],
    [new UsageError("Missing server"), 2, "usage_error"],
    [
      new CommandError("not_authenticated", "Not logged in"),
      1,
      "not_authenticated",
    ],
    [
      new CommandUsageError("organization_required", "Choose an organization"),
      2,
      "organization_required",
    ],
  ])("preserves the classification of %s", (error, exitCode, code) => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    expect(reportError(error, true)).toBe(exitCode);
    expect(JSON.parse(String(stderr.mock.calls[0]![0]))).toEqual({
      error: { code, message: error.message },
    });
  });
});

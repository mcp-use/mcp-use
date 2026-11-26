import { describe, expect, it } from "vitest";
import type { MCPClient } from "../../../src/core/node.js";
import {
  E2BCodeExecutor,
  extractProgramErrorMessage,
} from "../../../src/code-mode/executor-e2b.js";

/** Mirrors e2b's CommandExitError: a rejected run carries the exit data. */
class CommandExitError extends Error {
  exitCode: number;
  stdout: string;
  stderr: string;

  constructor(exitCode: number, stdout: string, stderr: string) {
    super("exit status 1");
    this.name = "CommandExitError";
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function makeExecutor(sandbox: unknown) {
  const executor = new E2BCodeExecutor({} as MCPClient, { apiKey: "test" });
  (executor as any).ensureServersConnected = async () => {};
  (executor as any).getOrCreateCodeExecSandbox = async () => sandbox;
  (executor as any).getToolNamespaces = () => [];
  return executor;
}

describe("E2BCodeExecutor exit handling (#3161)", () => {
  it("surfaces the thrown message and keeps stdout when the run exits non-zero", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const sandbox = {
      files: {
        write: async (path: string, content: string) => {
          writes.push({ path, content });
        },
      },
      commands: {
        run: async () => {
          throw new CommandExitError(
            1,
            "starting\n",
            "Error: boom\n    at func (exec_1.js:1:15)\n"
          );
        },
      },
    };

    const result = await makeExecutor(sandbox).execute(
      "console.log('starting'); throw new Error('boom');"
    );

    expect(result.error).toBe("boom");
    expect(result.logs.join("")).toContain("starting");
    expect(result.logs.join("")).not.toContain("at func");
    expect(writes).toHaveLength(1);
  });

  it("falls back to stderr when the program printed no error line", async () => {
    const sandbox = {
      files: { write: async () => {} },
      commands: {
        run: async () => {
          throw new CommandExitError(2, "", "segfault\n");
        },
      },
    };

    const result = await makeExecutor(sandbox).execute("x");

    expect(result.error).toBe("segfault");
  });

  it("does not swallow failures that carry no exit code", async () => {
    const sandbox = {
      files: { write: async () => {} },
      commands: {
        run: async () => {
          throw new Error("sandbox disconnected");
        },
      },
    };

    const result = await makeExecutor(sandbox).execute("x");

    expect(result.error).toBe("sandbox disconnected");
  });

  it("keeps program stderr diagnostics and only drops the thrown stack", async () => {
    const sandbox = {
      files: { write: async () => {} },
      commands: {
        run: async () => {
          throw new CommandExitError(
            1,
            "starting\n",
            "warning: about to fail\nError: boom\n    at f (x:1:1)\n"
          );
        },
      },
    };

    const result = await makeExecutor(sandbox).execute("x");

    expect(result.error).toBe("boom");
    const logs = result.logs.join("\n");
    expect(logs).toContain("starting");
    expect(logs).toContain("warning: about to fail");
    expect(logs).not.toContain("at f (x:1:1)");
  });

  it("reports the last thrown error, not earlier console.error output", async () => {
    const sandbox = {
      files: { write: async () => {} },
      commands: {
        run: async () => {
          throw new CommandExitError(
            1,
            "",
            "Error: warning\n    at g (x:1:1)\nError: boom\n    at f (x:1:1)\n"
          );
        },
      },
    };

    const result = await makeExecutor(sandbox).execute("x");

    expect(result.error).toBe("boom");
    expect(result.logs.join("\n")).toContain("Error: warning");
    expect(result.logs.join("\n")).not.toContain("at f (x:1:1)");
  });

  it("extracts the message from Node stderr", () => {
    expect(extractProgramErrorMessage("Error: boom\n    at f (x:1:1)")).toBe(
      "boom"
    );
    expect(
      extractProgramErrorMessage("starting\nTypeError: x is not a function")
    ).toBe("x is not a function");
    expect(extractProgramErrorMessage("plain output")).toBeNull();
    // The last error record wins over earlier diagnostics-like output.
    expect(
      extractProgramErrorMessage("Error: first\nError: second\n    at f")
    ).toBe("second");
  });
});

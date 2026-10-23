import { describe, expect, it, vi } from "vitest";

import { CodeModeConnector } from "../../../src/code-mode/connector.js";
import { E2BCodeExecutor } from "../../../src/code-mode/executor-e2b.js";
import { MCPClient } from "../../../src/core/node.js";

function codeModeClient(timeoutMs?: number): MCPClient {
  return new MCPClient(
    {},
    {
      codeMode: {
        enabled: true,
        ...(timeoutMs !== undefined && { executorOptions: { timeoutMs } }),
      },
    }
  );
}

describe("execute_code timeout", () => {
  it("applies codeMode.executorOptions.timeoutMs when the call omits timeout", async () => {
    const connector = new CodeModeConnector(codeModeClient(200));

    const started = Date.now();
    const res = await connector.callTool("execute_code", {
      code: "while (true) {}",
    });
    const body = JSON.parse((res.content[0] as { text: string }).text);

    expect(body.error).toBe("Script execution timed out");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("lets an explicit per-call timeout win over the configured one", async () => {
    const connector = new CodeModeConnector(codeModeClient(60_000));

    const started = Date.now();
    const res = await connector.callTool("execute_code", {
      code: "while (true) {}",
      timeout: 150,
    });
    const body = JSON.parse((res.content[0] as { text: string }).text);

    expect(body.error).toBe("Script execution timed out");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it.each([undefined, 0, -1, "5000"])(
    "leaves the timeout to the executor when the call passes %j",
    async (timeout) => {
      const client = codeModeClient();
      const executeCode = vi.spyOn(client, "executeCode").mockResolvedValue({
        result: null,
        logs: [],
        error: null,
        execution_time: 0,
      });

      await new CodeModeConnector(client).callTool("execute_code", {
        code: "return 1",
        ...(timeout !== undefined && { timeout }),
      });

      expect(executeCode).toHaveBeenCalledWith("return 1", undefined);
    }
  );

  it("does not advertise a fixed default timeout to the model", () => {
    const connector = new CodeModeConnector(codeModeClient());
    const executeCode = connector.tools.find((t) => t.name === "execute_code");
    const timeout = (
      executeCode?.inputSchema.properties as Record<
        string,
        { default?: unknown }
      >
    ).timeout;

    expect(timeout).toBeDefined();
    expect(timeout?.default).toBeUndefined();
  });

  describe("E2B executor", () => {
    /** E2B executor whose sandbox records the command timeout it is given. */
    function e2bExecutor(timeoutMs?: number) {
      const client = {
        getServerNames: () => [],
        getAllActiveSessions: () => ({}),
      } as unknown as MCPClient;
      const executor = new E2BCodeExecutor(client, {
        apiKey: "test",
        ...(timeoutMs !== undefined && { timeoutMs }),
      });
      const run = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
      const sandbox = {
        files: { write: vi.fn(async () => {}) },
        commands: { run },
      };
      Object.assign(executor as unknown as Record<string, unknown>, {
        SandboxClass: { create: vi.fn(async () => sandbox) },
      });
      const commandTimeout = () =>
        (run.mock.calls[0] as unknown as [string, { timeoutMs: number }])[1]
          .timeoutMs;
      return { executor, commandTimeout };
    }

    it("uses the configured timeoutMs when no timeout is passed", async () => {
      const { executor, commandTimeout } = e2bExecutor(120_000);
      await executor.execute("return 1");
      expect(commandTimeout()).toBe(120_000);
    });

    it("lets an explicit timeout win over the configured one", async () => {
      const { executor, commandTimeout } = e2bExecutor(120_000);
      await executor.execute("return 1", 5000);
      expect(commandTimeout()).toBe(5000);
    });

    it("keeps the 30000 default when nothing is configured", async () => {
      const { executor, commandTimeout } = e2bExecutor();
      await executor.execute("return 1");
      expect(commandTimeout()).toBe(30000);
    });
  });
});

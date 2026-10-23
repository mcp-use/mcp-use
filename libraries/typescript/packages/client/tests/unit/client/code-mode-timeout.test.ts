import { describe, expect, it, vi } from "vitest";

import { CodeModeConnector } from "../../../src/code-mode/connector.js";
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
});

import { describe, it, expect, vi } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";
import { E2BCodeExecutor } from "../../../src/code-mode/executor-e2b.js";
import type { MCPClient } from "../../../src/core/node.js";

function makeTool(name: string): Tool {
  return {
    name,
    description: "a tool",
    inputSchema: { type: "object", properties: {} },
  } as Tool;
}

/**
 * Evaluates the generated shim in a sandboxed function scope with a stubbed
 * `global.__callMcpTool`, so we can inspect what namespaces/keys it produces.
 */
function evalShim(shim: string) {
  const calls: Array<{ server: string; tool: string; args: unknown }> = [];
  const global: Record<string, any> = {
    __callMcpTool: async (server: string, tool: string, args: unknown) => {
      calls.push({ server, tool, args });
      return { ok: true };
    },
  };

  // eslint-disable-next-line no-new-func
  const run = new Function("global", "console", shim);
  run(global, { log: () => {} });

  return { global, calls };
}

describe("E2BCodeExecutor shim generation", () => {
  const executor = new E2BCodeExecutor({} as MCPClient, { apiKey: "test" });

  it("generates valid shim code for names with special characters", () => {
    const weirdToolName = "it's a {weird}\\ name'";
    const tools: Record<string, Tool[]> = {
      "my-server": [makeTool(weirdToolName)],
    };

    const shim = (executor as any).generateShim(tools);

    // The generated code should be syntactically valid JavaScript.
    // eslint-disable-next-line no-new-func
    expect(() => new Function(shim)).not.toThrow();

    const { global } = evalShim(shim);

    expect(global["my-server"]).toBeDefined();
    expect(typeof global["my-server"][weirdToolName]).toBe("function");
  });

  it("exposes a safe alias when the server name differs from its safe form", () => {
    const tools: Record<string, Tool[]> = {
      "my-server": [makeTool("do_thing")],
    };

    const shim = (executor as any).generateShim(tools);
    // eslint-disable-next-line no-new-func
    expect(() => new Function(shim)).not.toThrow();

    const { global } = evalShim(shim);

    expect(global["my-server"]).toBeDefined();
    expect(global["my_server"]).toBeDefined();
    expect(global["my_server"]).toBe(global["my-server"]);
  });

  it("does not emit an alias line when the server name is already safe", () => {
    const tools: Record<string, Tool[]> = {
      my_server: [makeTool("do_thing")],
    };

    const shim = (executor as any).generateShim(tools);
    // eslint-disable-next-line no-new-func
    expect(() => new Function(shim)).not.toThrow();

    // No conditional alias re-assignment should be generated for a name that
    // is already a valid identifier.
    expect(shim).not.toContain("Also expose as safe name");

    const { global } = evalShim(shim);
    expect(global["my_server"]).toBeDefined();
  });
});

describe("E2BCodeExecutor stdout bridge", () => {
  function createExecutor(
    stdoutChunks: string[],
    write = vi.fn().mockResolvedValue(undefined)
  ) {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: '{"ok":true}' }],
    });
    const executor = new E2BCodeExecutor(
      {
        getServerNames: () => ["tools"],
        getAllActiveSessions: () => ({
          tools: {
            connector: {
              tools: [makeTool("echo")],
              callTool,
            },
          },
        }),
      } as unknown as MCPClient,
      { apiKey: "test" }
    );
    (executor as any).codeExecSandbox = {
      files: { write },
      commands: {
        run: vi.fn(async (_command: string, options: any) => {
          for (const chunk of stdoutChunks) {
            await options.onStdout(chunk);
          }
          return {
            stdout: "__MCP_RESULT_START__\nnull\n__MCP_RESULT_END__",
            stderr: "",
            exitCode: 0,
          };
        }),
      },
    };

    return { executor, callTool, write };
  }

  it("buffers a tool call split across stdout callbacks", async () => {
    const { executor, callTool, write } = createExecutor([
      '{"type":"__MCP_TOOL_CALL__","id":"call-1","server":"tools",',
      '"tool":"echo","args":{"message":"hi"}}\n',
    ]);

    await executor.execute("return null;");

    expect(callTool).toHaveBeenCalledWith("echo", { message: "hi" });
    expect(write).toHaveBeenCalledWith(
      "/tmp/mcp_result_call-1.json",
      '{"data":{"ok":true}}'
    );
  });

  it("processes multiple complete tool calls from one stdout callback", async () => {
    const { executor, callTool, write } = createExecutor([
      '{"type":"__MCP_TOOL_CALL__","id":"call-1","server":"tools","tool":"echo","args":{"message":"first"}}\n' +
        '{"type":"__MCP_TOOL_CALL__","id":"call-2","server":"tools","tool":"echo","args":{"message":"second"}}\n',
    ]);

    await executor.execute("return null;");

    expect(callTool).toHaveBeenNthCalledWith(1, "echo", {
      message: "first",
    });
    expect(callTool).toHaveBeenNthCalledWith(2, "echo", {
      message: "second",
    });
    expect(write).toHaveBeenCalledWith(
      "/tmp/mcp_result_call-2.json",
      '{"data":{"ok":true}}'
    );
  });

  it("skips malformed bridge records and processes the following record", async () => {
    const { executor, callTool } = createExecutor([
      '{"type":"__MCP_TOOL_CALL__","id":"invalid"\n' +
        '{"type":"__MCP_TOOL_CALL__","id":"call-1","server":"tools","tool":"echo","args":{"message":"valid"}}\n',
    ]);

    await executor.execute("return null;");

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith("echo", { message: "valid" });
  });

  it("keeps a trailing partial bridge record undispatched", async () => {
    const { executor, callTool } = createExecutor([
      '{"type":"__MCP_TOOL_CALL__","id":"call-1","server":"tools",',
    ]);

    await executor.execute("return null;");

    expect(callTool).not.toHaveBeenCalled();
  });

  it("does not let a failed result write escape the stdout callback", async () => {
    const write = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("write failed"));
    const { executor, callTool } = createExecutor(
      [
        '{"type":"__MCP_TOOL_CALL__","id":"call-1","server":"tools","tool":"echo","args":{}}\n',
      ],
      write
    );

    const result = await executor.execute("return null;");

    expect(callTool).toHaveBeenCalledWith("echo", {});
    expect(result.error).toBeNull();
  });
});

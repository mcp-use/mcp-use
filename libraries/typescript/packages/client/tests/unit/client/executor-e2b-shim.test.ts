import { describe, it, expect } from "vitest";
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

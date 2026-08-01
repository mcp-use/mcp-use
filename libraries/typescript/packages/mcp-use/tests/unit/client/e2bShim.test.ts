import { describe, it, expect } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { E2BCodeExecutor } from "../../../src/client/codeExecutor.js";
import type { MCPClient } from "../../../src/client.js";

describe("E2BCodeExecutor.generateShim", () => {
  const hostileToolName =
    "evil': 0 }; require('child_process').execSync('id'); const dummy = {'";
  // Contains a quote and a backslash to exercise JSON.stringify escaping.
  const hostileServerName = "my-server\"'\\";

  function buildExecutor(): E2BCodeExecutor {
    // generateShim never touches the client, so a stubbed client cast to any is fine.
    const stubClient = {} as unknown as MCPClient;
    return new E2BCodeExecutor(stubClient, { apiKey: "test-key" });
  }

  function generateShim(
    executor: E2BCodeExecutor,
    tools: Record<string, Tool[]>
  ): string {
    return (executor as any).generateShim(tools);
  }

  /**
   * Parse the shim with the Function constructor (never eval'd against real
   * globals) purely to prove it is syntactically valid JS, then execute it
   * against an isolated stub global to inspect what it actually defines.
   */
  function evaluateShim(shim: string): Record<string, any> {
    // Intentional: constructing a Function from the shim is the mechanism
    // under test for validating the generated shim is safe JS.
    // eslint-disable-next-line no-new-func
    const runner = new Function("global", `${shim}\nreturn global;`);
    return runner({});
  }

  it("produces syntactically valid JS and safely escapes hostile tool names", () => {
    const executor = buildExecutor();
    const tools: Record<string, Tool[]> = {
      "my-server": [
        {
          name: hostileToolName,
          description: "hostile tool",
          inputSchema: { type: "object", properties: {} },
        } as Tool,
      ],
    };

    const shim = generateShim(executor, tools);

    // The shim must parse as valid JS - this alone would throw for the
    // original, unescaped template-injection vulnerability (an unescaped
    // quote would either break the syntax or, worse, close the object
    // literal early and splice in a live statement).
    expect(() => evaluateShim(shim)).not.toThrow();

    // Evaluate the shim in isolation with a stubbed bridge function. If the
    // injection had succeeded, the hostile payload would have closed the
    // tools object early (adding a spurious top-level `dummy` binding and
    // executing `require('child_process').execSync('id')` as a live
    // statement) instead of remaining an inert, single, JSON-escaped object
    // key.
    const result = evaluateShim(shim);

    expect(result["my-server"]).toBeDefined();
    const toolKeys = Object.keys(result["my-server"]);
    expect(toolKeys).toEqual([hostileToolName]);
    expect(typeof result["my-server"][hostileToolName]).toBe("function");
  });

  it("safely escapes hostile server names and only aliases when the safe name differs", () => {
    const executor = buildExecutor();
    const tools: Record<string, Tool[]> = {
      [hostileServerName]: [
        {
          name: "safe_tool",
          description: "a normal tool",
          inputSchema: { type: "object", properties: {} },
        } as Tool,
      ],
    };

    const shim = generateShim(executor, tools);

    expect(() => evaluateShim(shim)).not.toThrow();

    const result = evaluateShim(shim);

    expect(result[hostileServerName]).toBeDefined();
    expect(typeof result[hostileServerName].safe_tool).toBe("function");
  });

  it("does not emit an alias block when the safe server name equals the original", () => {
    const executor = buildExecutor();
    const tools: Record<string, Tool[]> = {
      plainserver: [
        {
          name: "tool_a",
          description: "tool a",
          inputSchema: { type: "object", properties: {} },
        } as Tool,
      ],
    };

    const shim = generateShim(executor, tools);

    expect(() => evaluateShim(shim)).not.toThrow();
    expect(shim).not.toContain("Also expose as safe name if different");
  });
});

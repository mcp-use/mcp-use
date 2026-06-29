import { describe, expect, it } from "vitest";
import { parseEvalSpec } from "../../src/eval/schema.js";

describe("EvalSpecSchema", () => {
  it("parses a minimal local tool eval", () => {
    const spec = parseEvalSpec({
      apiVersion: "mcp-use.dev/eval/v1",
      name: "smoke",
      tests: [
        {
          type: "tool",
          name: "hello",
          tool: "hello",
          input: { name: "Ada" },
          expect: [{ type: "content_contains", value: "Ada" }],
        },
      ],
    });

    expect(spec.runner).toBe("local");
    expect(spec.tests[0]).toMatchObject({ type: "tool", tool: "hello" });
  });

  it("accepts local MCPClient server config", () => {
    const spec = parseEvalSpec({
      apiVersion: "mcp-use.dev/eval/v1",
      name: "protocol-smoke",
      server: "fixture",
      mcpServers: {
        fixture: {
          command: "node",
          args: ["server.js"],
        },
      },
      tests: [
        {
          type: "protocol",
          name: "tools list",
          method: "tools/list",
        },
      ],
    });

    expect(spec.server).toBe("fixture");
    expect(spec.mcpServers?.fixture.command).toBe("node");
  });
});

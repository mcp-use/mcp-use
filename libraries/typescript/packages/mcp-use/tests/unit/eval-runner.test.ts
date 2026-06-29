import { describe, expect, it } from "vitest";
import { runEvalSpecs, type EvalClientFactory } from "../../src/eval/index.js";

function createFakeClientFactory(): EvalClientFactory {
  return () => ({
    async createAllSessions() {},
    getServerNames() {
      return ["fixture"];
    },
    getSession(name) {
      if (name !== "fixture") return null;
      return {
        async listTools() {
          return [{ name: "hello" }];
        },
        async callTool(toolName, input) {
          return {
            content: [
              {
                type: "text",
                text: `${toolName}:${String(input?.name ?? "unknown")}`,
              },
            ],
          };
        },
      };
    },
    async close() {},
  });
}

describe("runEvalSpecs", () => {
  it("runs protocol and tool tests through a local MCP client session", async () => {
    const report = await runEvalSpecs(
      [
        {
          apiVersion: "mcp-use.dev/eval/v1",
          name: "smoke",
          runner: "local",
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
              name: "list tools",
              method: "tools/list",
              params: {},
              expect: [{ type: "content_contains", value: "hello" }],
            },
            {
              type: "tool",
              name: "call hello",
              tool: "hello",
              input: { name: "Ada" },
              expect: [{ type: "content_contains", value: "Ada" }],
            },
          ],
        },
      ],
      {
        createClient: createFakeClientFactory(),
      }
    );

    expect(report.status).toBe("passed");
    expect(report.summary).toMatchObject({ tests: 2, passed: 2, failed: 0 });
  });

  it("fails clearly for hosted runners", async () => {
    await expect(runEvalSpecs([], { runner: "chatgpt" })).rejects.toThrow(
      /chatgpt eval runner is not implemented/i
    );
  });

  it("reports missing mcpServers for local runs", async () => {
    const report = await runEvalSpecs(
      [
        {
          apiVersion: "mcp-use.dev/eval/v1",
          name: "missing-server",
          runner: "local",
          tests: [
            {
              type: "tool",
              name: "call hello",
              tool: "hello",
              input: {},
              expect: [],
            },
          ],
        },
      ],
      {
        createClient: createFakeClientFactory(),
      }
    );

    expect(report.status).toBe("failed");
    expect(report.specs[0].error).toMatch(/mcpServers/);
  });
});

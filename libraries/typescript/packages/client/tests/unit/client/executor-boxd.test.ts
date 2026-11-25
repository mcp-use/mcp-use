import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";
import { BoxdCodeExecutor } from "../../../src/code-mode/executor-boxd.js";
import { MCPClient } from "../../../src/core/node.js";

/**
 * A stand-in for the boxd API. Each "machine" is a temp directory on this
 * host, and streamExec runs the command with the local shell and node, so
 * the generated shim and the stdin/stdout tool bridge run for real.
 */
const fakeBoxd = vi.hoisted(() => ({
  clients: [] as Array<{ apiKey: string; region?: string }>,
  created: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  started: [] as string[],
  stopped: new Set<string>(),
  roots: new Map<string, string>(),
  uploads: [] as string[],
  readyDelayMs: 0,
  readyFailures: 0,
  gone: new Set<string>(),
  readyCalls: [] as string[],
}));

vi.mock("@boxd-sh/sdk", () => {
  class Boxd {
    machines = {
      create: async (params: Record<string, unknown>) => {
        const id = `m-${fakeBoxd.created.length + 1}`;
        fakeBoxd.created.push(params);
        fakeBoxd.roots.set(
          id,
          fs.mkdtempSync(path.join(os.tmpdir(), "boxd-fake-"))
        );
        return { id };
      },
      waitUntilReady: async (id: string) => {
        fakeBoxd.readyCalls.push(id);
        await new Promise((r) => setTimeout(r, fakeBoxd.readyDelayMs));
        if (fakeBoxd.readyFailures > 0) {
          fakeBoxd.readyFailures--;
          throw new Error("machine did not become ready");
        }
        return { id, status: "running" };
      },
      get: async (id: string) => ({
        id,
        status: fakeBoxd.stopped.has(id) ? "stopped" : "running",
      }),
      delete: async (id: string) => {
        fakeBoxd.deleted.push(id);
      },
      start: async (id: string) => {
        fakeBoxd.started.push(id);
        fakeBoxd.stopped.delete(id);
      },
      files: {
        upload: async (id: string, file: string, source: string) => {
          if (!fakeBoxd.readyCalls.includes(id)) {
            throw new Error(`upload to ${id} before it was ready`);
          }
          if (fakeBoxd.gone.has(id)) {
            const error = new Error(`machine ${id} not found`);
            error.name = "NotFoundError";
            throw error;
          }
          if (fakeBoxd.stopped.has(id)) {
            const error = new Error(`machine ${id} is stopped`);
            error.name = "ConflictError";
            throw error;
          }
          fakeBoxd.uploads.push(file);
          const target = path.join(fakeBoxd.roots.get(id)!, file);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, source);
          return source.length;
        },
      },
      streamExec: (id: string, params: { command: string }) => {
        const root = fakeBoxd.roots.get(id)!;
        let command = params.command;
        for (const file of fakeBoxd.uploads) {
          command = command.replaceAll(file, path.join(root, file));
        }
        const child = spawn("bash", ["-c", command], {
          stdio: ["pipe", "pipe", "pipe"],
          detached: true,
        });
        const exit = new Promise<number>((resolve) =>
          child.on("close", (code) => resolve(code ?? 1))
        );
        return {
          [Symbol.asyncIterator]: () => child.stdout[Symbol.asyncIterator](),
          stderr: child.stderr,
          write: (data: string) => child.stdin.write(data),
          wait: () => exit,
          // Like the real API, closing the stream kills the process group
          close: () => process.kill(-child.pid!, "SIGKILL"),
        };
      },
    };

    constructor(options: { apiKey: string; region?: string }) {
      fakeBoxd.clients.push(options);
    }
  }
  return { Boxd };
});

function makeTool(name: string): Tool {
  return {
    name,
    description: "a tool",
    inputSchema: { type: "object", properties: {} },
  } as Tool;
}

/** A client with one fake server whose tools answer from `handler`. */
function clientWithServer(
  handler: (tool: string, args: any) => Promise<unknown>
): MCPClient {
  const client = new MCPClient({});
  client.sessions.calc = {
    connector: {
      tools: [makeTool("add"), makeTool("fail")],
      callTool: async (tool: string, args: any) => handler(tool, args),
    },
  } as never;
  client.activeSessions.push("calc");
  return client;
}

function evalShim(shim: string) {
  const global: Record<string, any> = {
    __callMcpTool: async () => ({ ok: true }),
  };
  // eslint-disable-next-line no-new-func
  const run = new Function("global", "console", "require", "process", shim);
  run(global, { log: () => {} }, () => ({}), {});
  return { global };
}

beforeEach(() => {
  fakeBoxd.clients.length = 0;
  fakeBoxd.created.length = 0;
  fakeBoxd.deleted.length = 0;
  fakeBoxd.started.length = 0;
  fakeBoxd.stopped.clear();
  fakeBoxd.roots.clear();
  fakeBoxd.uploads.length = 0;
  fakeBoxd.readyDelayMs = 0;
  fakeBoxd.readyFailures = 0;
  fakeBoxd.gone.clear();
  fakeBoxd.readyCalls.length = 0;
  vi.unstubAllEnvs();
});

afterEach(() => {
  for (const root of fakeBoxd.roots.values()) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

describe("BoxdCodeExecutor shim generation", () => {
  const executor = new BoxdCodeExecutor({} as MCPClient, { apiKey: "test" });

  it("generates valid shim code for names with special characters", () => {
    const weirdToolName = "it's a {weird}\\ name'";
    const shim = (executor as any).generateShim({
      "my-server": [makeTool(weirdToolName)],
    });

    // eslint-disable-next-line no-new-func
    expect(() => new Function(shim)).not.toThrow();
    const { global } = evalShim(shim);
    expect(typeof global["my-server"][weirdToolName]).toBe("function");
  });

  it("exposes a safe alias when the server name differs from its safe form", () => {
    const shim = (executor as any).generateShim({
      "my-server": [makeTool("do_thing")],
    });

    const { global } = evalShim(shim);
    expect(global["my_server"]).toBe(global["my-server"]);
  });
});

describe("BoxdCodeExecutor", () => {
  it("returns the code's result and its logs", async () => {
    const executor = new BoxdCodeExecutor(
      clientWithServer(async () => ({})),
      {
        apiKey: "key",
      }
    );

    const out = await executor.execute(`
      console.log("hello from the machine");
      return { sum: 1 + 2 };
    `);

    expect(out.error).toBeNull();
    expect(out.result).toEqual({ sum: 3 });
    expect(out.logs.join("\n")).toContain("hello from the machine");
    expect(out.logs.join("\n")).not.toContain("__MCP_RESULT_START__");
  });

  it("runs tool calls on the host and returns their results to the code", async () => {
    const calls: Array<{ tool: string; args: unknown }> = [];
    const executor = new BoxdCodeExecutor(
      clientWithServer(async (tool, args) => {
        calls.push({ tool, args });
        return {
          content: [{ type: "text", text: JSON.stringify(args.a + args.b) }],
        };
      }),
      { apiKey: "key" }
    );

    const out = await executor.execute(`
      const one = await calc.add({ a: 1, b: 2 });
      const [two, three] = await Promise.all([
        calc.add({ a: 10, b: 20 }),
        calc.add({ a: 100, b: 200 }),
      ]);
      return [one, two, three];
    `);

    expect(out.error).toBeNull();
    expect(out.result).toEqual([3, 30, 300]);
    expect(calls).toHaveLength(3);
    expect(out.logs.join("\n")).not.toContain("__MCP_TOOL_CALL__");
  });

  it("raises a failed tool call inside the code", async () => {
    const executor = new BoxdCodeExecutor(
      clientWithServer(async () => {
        throw new Error("tool exploded");
      }),
      { apiKey: "key" }
    );

    const out = await executor.execute(`
      try {
        await calc.fail({});
        return "no error";
      } catch (e) {
        return e.message;
      }
    `);

    expect(out.error).toBeNull();
    expect(out.result).toBe("tool exploded");
  });

  it("reports an error when the code throws", async () => {
    const executor = new BoxdCodeExecutor(
      clientWithServer(async () => ({})),
      {
        apiKey: "key",
      }
    );

    const out = await executor.execute(`throw new Error("boom");`);

    expect(out.result).toBeNull();
    expect(out.error).toContain("boom");
  });

  it("stops code that runs past the timeout", async () => {
    const executor = new BoxdCodeExecutor(
      clientWithServer(async () => ({})),
      {
        apiKey: "key",
      }
    );

    const out = await executor.execute(
      `await new Promise((r) => setTimeout(r, 60000));`,
      500
    );

    expect(out.error).toBe("Script execution timed out");
  });

  it("creates one isolated machine, reuses it, and deletes it in cleanup()", async () => {
    const executor = new BoxdCodeExecutor(
      clientWithServer(async () => ({})),
      {
        apiKey: "key",
        org: "acme",
        region: "fra",
        name: "code-mode",
        labels: { app: "agent" },
      }
    );

    const [a, b] = await Promise.all([
      executor.execute("return 1;"),
      executor.execute("return 2;"),
    ]);
    const c = await executor.execute("return 3;");

    expect([a.result, b.result, c.result]).toEqual([1, 2, 3]);
    expect(fakeBoxd.clients).toEqual([{ apiKey: "key", region: "fra" }]);
    expect(fakeBoxd.created).toEqual([
      {
        isolated: true,
        org: "acme",
        name: "code-mode",
        labels: { app: "agent" },
      },
    ]);

    await executor.cleanup();
    expect(fakeBoxd.deleted).toEqual(["m-1"]);
  });

  it("waits until the machine is ready before running concurrent first calls", async () => {
    fakeBoxd.readyDelayMs = 200;
    const executor = new BoxdCodeExecutor(
      clientWithServer(async () => ({})),
      {
        apiKey: "key",
      }
    );

    const first = executor.execute("return 1;");
    await new Promise((r) => setTimeout(r, 50));
    const second = executor.execute("return 2;");

    expect((await first).result).toBe(1);
    expect((await second).result).toBe(2);
    expect(fakeBoxd.created).toHaveLength(1);
  });

  it("waits for readiness again after a failed wait, on the same machine", async () => {
    fakeBoxd.readyFailures = 1;
    const executor = new BoxdCodeExecutor(
      clientWithServer(async () => ({})),
      {
        apiKey: "key",
      }
    );

    const failed = await executor.execute("return 1;");
    const retried = await executor.execute("return 2;");

    expect(failed.error).toBe("machine did not become ready");
    expect(retried.result).toBe(2);
    expect(fakeBoxd.created).toHaveLength(1);
    expect(fakeBoxd.readyCalls).toEqual(["m-1", "m-1"]);
  });

  it("replaces a machine that no longer exists", async () => {
    const executor = new BoxdCodeExecutor(
      clientWithServer(async () => ({})),
      {
        apiKey: "key",
      }
    );
    await executor.execute("return 1;");
    fakeBoxd.gone.add("m-1");

    const out = await executor.execute("return 2;");
    await executor.cleanup();

    expect(out.result).toBe(2);
    expect(fakeBoxd.created).toHaveLength(2);
    expect(fakeBoxd.deleted).toEqual(["m-2"]);
  });

  it("starts a stopped machine and runs the code", async () => {
    const executor = new BoxdCodeExecutor(
      clientWithServer(async () => ({})),
      {
        apiKey: "key",
      }
    );
    await executor.execute("return 1;");
    fakeBoxd.stopped.add("m-1");

    const out = await executor.execute("return 2;");

    expect(out.error).toBeNull();
    expect(out.result).toBe(2);
    expect(fakeBoxd.started).toEqual(["m-1"]);
    expect(fakeBoxd.created).toHaveLength(1);
  });

  it("sets a delete timer only when timeoutMs is given", async () => {
    const executor = new BoxdCodeExecutor(
      clientWithServer(async () => ({})),
      {
        apiKey: "key",
        timeoutMs: 90_500,
      }
    );

    await executor.execute("return 1;");

    expect(fakeBoxd.created[0]).toMatchObject({ deleteAfter: 91 });
  });

  it("reads BOXD_API_KEY and BOXD_ORG from the environment", async () => {
    vi.stubEnv("BOXD_API_KEY", "env-key");
    vi.stubEnv("BOXD_ORG", "env-org");
    const executor = new BoxdCodeExecutor(clientWithServer(async () => ({})));

    await executor.execute("return 1;");

    expect(fakeBoxd.clients[0]).toMatchObject({ apiKey: "env-key" });
    expect(fakeBoxd.created[0]).toMatchObject({ org: "env-org" });
  });

  it("refuses to start without an API key", () => {
    vi.stubEnv("BOXD_API_KEY", "");
    expect(() => new BoxdCodeExecutor({} as MCPClient, {})).toThrow(
      /BOXD_API_KEY/
    );
  });

  it("does nothing in cleanup() when no machine was created", async () => {
    const executor = new BoxdCodeExecutor({} as MCPClient, { apiKey: "key" });
    await executor.cleanup();
    expect(fakeBoxd.deleted).toEqual([]);
  });
});

describe('MCPClient with executor: "boxd"', () => {
  it("runs code on a boxd machine and deletes it on close()", async () => {
    const client = new MCPClient(
      {},
      {
        codeMode: {
          enabled: true,
          executor: "boxd",
          executorOptions: { apiKey: "key", region: "nyc" },
        },
      }
    );

    const out = await client.executeCode("return 40 + 2;");
    expect(out.result).toBe(42);
    expect(fakeBoxd.created).toHaveLength(1);
    expect(fakeBoxd.created[0]).toMatchObject({ isolated: true });

    await client.close();
    expect(fakeBoxd.deleted).toEqual(["m-1"]);
  });

  it("fails with a clear error instead of running locally when no API key is set", async () => {
    vi.stubEnv("BOXD_API_KEY", "");
    const client = new MCPClient(
      {},
      { codeMode: { enabled: true, executor: "boxd" } }
    );

    await expect(client.executeCode("return 1;")).rejects.toThrow(
      /BOXD_API_KEY/
    );
    expect(fakeBoxd.created).toEqual([]);
  });
});

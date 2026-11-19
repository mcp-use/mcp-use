import { describe, expect, it } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";
import { VMCodeExecutor } from "../../../src/code-mode/executor-vm.js";
import type { MCPClient } from "../../../src/core/node.js";

function makeTool(name: string): Tool {
  return {
    name,
    description: "a tool",
    inputSchema: { type: "object", properties: {} },
  } as Tool;
}

function fakeClient(serverName: string, toolName: string) {
  const tools = [makeTool(toolName)];
  const session = {
    connector: {
      get tools() {
        return tools;
      },
      callTool: async (name: string, args: unknown) => ({
        content: [
          { type: "text", text: JSON.stringify({ called: name, args }) },
        ],
      }),
    },
  };
  return {
    getServerNames: () => [serverName],
    getAllActiveSessions: () => ({ [serverName]: session }),
  } as unknown as MCPClient;
}

describe("VM code executor server namespaces", () => {
  it("exposes a server name with a hyphen through the sanitized alias", async () => {
    // The E2B shim already exposes `my_server` for a server named
    // `my-server` (executor-e2b.ts); the VM executor must agree so the same
    // code-mode snippet works on both.
    const executor = new VMCodeExecutor(
      fakeClient("my-server", "do_thing"),
      {}
    );
    const result = await executor.execute(
      "return await my_server.do_thing({ a: 1 });"
    );

    expect(result.error).toBeNull();
    expect(result.result).toEqual({ called: "do_thing", args: { a: 1 } });
  });

  it("sanitizes every non-identifier character, not just hyphens", async () => {
    const executor = new VMCodeExecutor(
      fakeClient("my.server v2", "do_thing"),
      {}
    );
    const result = await executor.execute(
      "return await my_server_v2.do_thing({});"
    );

    expect(result.error).toBeNull();
    expect(result.result).toEqual({ called: "do_thing", args: {} });
  });

  it("keeps the plain global for a name that is already an identifier", async () => {
    const executor = new VMCodeExecutor(fakeClient("myserver", "do_thing"), {});
    const result = await executor.execute(
      "return await myserver.do_thing({ a: 2 });"
    );

    expect(result.error).toBeNull();
    expect(result.result).toEqual({ called: "do_thing", args: { a: 2 } });
  });

  it("does not let a sanitized alias shadow the search_tools helper", async () => {
    // A server named `search-tools` sanitizes to `search_tools`; the helper
    // must stay callable rather than being replaced by the namespace.
    const executor = new VMCodeExecutor(fakeClient("search-tools", "ping"), {});
    const result = await executor.execute(
      'return { helper: typeof search_tools, raw: typeof globalThis["search-tools"] };'
    );

    expect(result.error).toBeNull();
    expect(result.result).toEqual({ helper: "function", raw: "object" });
  });

  it("does not turn a __proto__ server name into the sandbox prototype", async () => {
    // A server literally named `__proto__` has no alias (the name is already
    // "safe"), so the raw registration must be an own property too.
    const executor = new VMCodeExecutor(fakeClient("__proto__", "ping"), {});
    const result = await executor.execute(
      'return { bare: typeof ping, own: Object.prototype.hasOwnProperty.call(globalThis, "__proto__"), namespaces: __tool_namespaces };'
    );

    expect(result.error).toBeNull();
    expect(result.result).toEqual({
      bare: "undefined",
      own: true,
      namespaces: ["__proto__"],
    });
  });

  it("does not turn a __proto__ alias into the sandbox prototype", async () => {
    // `--proto--` sanitizes to `__proto__`; assigning that key would replace
    // the sandbox's prototype and expose `do_thing` as a bare global.
    const executor = new VMCodeExecutor(fakeClient("--proto--", "ping"), {});
    const result = await executor.execute(
      'return { bare: typeof ping, own: Object.prototype.hasOwnProperty.call(globalThis, "__proto__"), namespaces: __tool_namespaces };'
    );

    expect(result.error).toBeNull();
    expect(result.result).toEqual({
      bare: "undefined",
      own: true,
      // __tool_namespaces lists the server names as registered (raw names).
      namespaces: ["--proto--"],
    });
  });
});

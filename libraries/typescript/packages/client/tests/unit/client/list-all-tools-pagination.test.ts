import { describe, expect, it } from "vitest";

import { BaseConnector } from "../../../src/transport/base.js";

class TestConnector extends BaseConnector {
  async connect(): Promise<void> {}

  get publicIdentifier(): Record<string, string> {
    return { type: "test" };
  }
}

type MutableConnector = BaseConnector & {
  client: unknown;
  capabilitiesCache: unknown;
};

/**
 * `listTools`/`listPrompts` return only the first page and drop `nextCursor`,
 * so a server that paginates its catalog silently loses every entry past the
 * first page. `listAllTools`/`listAllPrompts` must follow pagination to the end.
 */
describe("listAllTools pagination", () => {
  it("follows nextCursor across every page and returns all tools", async () => {
    const connector = new TestConnector() as MutableConnector;

    // 3 pages of 20 tools each = 60 tools total.
    const pages = [
      { tools: makeTools(0, 20), nextCursor: "p2" },
      { tools: makeTools(20, 20), nextCursor: "p3" },
      { tools: makeTools(40, 20), nextCursor: undefined },
    ];
    let call = 0;
    connector.client = {
      async listTools(_params?: { cursor?: string }) {
        return pages[call++];
      },
    };

    const tools = await connector.listAllTools();

    expect(tools).toHaveLength(60);
    expect(tools[0].name).toBe("tool_0");
    expect(tools[59].name).toBe("tool_59");
    expect(call).toBe(3);
  });

  it("treats an empty-string cursor as 'another page', not the end", async () => {
    const connector = new TestConnector() as MutableConnector;

    // Server returns "" as a valid cursor for the next page (spec-legal).
    const pages = [
      { tools: makeTools(0, 2), nextCursor: "" },
      { tools: makeTools(2, 2), nextCursor: undefined },
    ];
    let call = 0;
    connector.client = {
      async listTools() {
        return pages[call++];
      },
    };

    const tools = await connector.listAllTools();

    // A naive `while (cursor)` loop would stop after page 1 and return 2.
    expect(tools).toHaveLength(4);
    expect(call).toBe(2);
  });

  it("rejects a repeated cursor instead of looping forever", async () => {
    const connector = new TestConnector() as MutableConnector;

    connector.client = {
      async listTools() {
        // Always points back to the same cursor: an infinite loop if unguarded.
        return { tools: makeTools(0, 1), nextCursor: "stuck" };
      },
    };

    await expect(connector.listAllTools()).rejects.toThrow(
      "tools/list returned a repeated pagination cursor"
    );
  });

  it("stops when nextCursor is null, not just undefined", async () => {
    const connector = new TestConnector() as MutableConnector;

    // Servers may signal "no more pages" with an explicit null cursor.
    let call = 0;
    connector.client = {
      async listTools() {
        call += 1;
        return { tools: makeTools(0, 2), nextCursor: null };
      },
    };

    const tools = await connector.listAllTools();

    // A `!== undefined` check would treat null as "another page" and either
    // make a bogus second call or throw a repeated-cursor error.
    expect(tools).toHaveLength(2);
    expect(call).toBe(1);
  });

  it("propagates -32601 so callers decide (initialize -> [], refresh keeps cache)", async () => {
    const connector = new TestConnector() as MutableConnector;

    connector.client = {
      async listTools() {
        throw Object.assign(new Error("Method not found"), { code: -32601 });
      },
    };

    // Unlike prompts, tools/list not-implemented is not swallowed here; the
    // single-page listTools() also throws, and callers handle it.
    await expect(connector.listAllTools()).rejects.toThrow("Method not found");
  });
});

describe("listAllPrompts pagination", () => {
  it("follows nextCursor across every page and returns all prompts", async () => {
    const connector = new TestConnector() as MutableConnector;
    connector.capabilitiesCache = { prompts: {} };

    const pages = [
      { prompts: makePrompts(0, 15), nextCursor: "p2" },
      { prompts: makePrompts(15, 15), nextCursor: undefined },
    ];
    let call = 0;
    connector.client = {
      async listPrompts() {
        return pages[call++];
      },
    };

    const { prompts } = await connector.listAllPrompts();

    expect(prompts).toHaveLength(30);
    expect(prompts[29].name).toBe("prompt_29");
    expect(call).toBe(2);
  });

  it("rejects a repeated cursor instead of looping forever", async () => {
    const connector = new TestConnector() as MutableConnector;
    connector.capabilitiesCache = { prompts: {} };

    connector.client = {
      async listPrompts() {
        return { prompts: makePrompts(0, 1), nextCursor: "stuck" };
      },
    };

    await expect(connector.listAllPrompts()).rejects.toThrow(
      "prompts/list returned a repeated pagination cursor"
    );
  });

  it("returns no prompts when the server does not advertise the capability", async () => {
    const connector = new TestConnector() as MutableConnector;
    connector.capabilitiesCache = {}; // no prompts capability

    let called = false;
    connector.client = {
      async listPrompts() {
        called = true;
        return { prompts: [], nextCursor: undefined };
      },
    };

    const { prompts } = await connector.listAllPrompts();

    expect(prompts).toEqual([]);
    expect(called).toBe(false);
  });

  it("returns no prompts when a capable server still answers -32601", async () => {
    const connector = new TestConnector() as MutableConnector;
    connector.capabilitiesCache = { prompts: {} };

    connector.client = {
      async listPrompts() {
        throw Object.assign(new Error("Method not found"), { code: -32601 });
      },
    };

    // Mirrors single-page listPrompts(): a -32601 is treated as "no prompts",
    // not an error, and the shape stays { prompts: [] }.
    await expect(connector.listAllPrompts()).resolves.toEqual({ prompts: [] });
  });
});

function makeTools(start: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `tool_${start + i}`,
    description: `Tool number ${start + i}`,
    inputSchema: { type: "object", properties: {} },
  }));
}

function makePrompts(start: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `prompt_${start + i}`,
    description: `Prompt number ${start + i}`,
  }));
}

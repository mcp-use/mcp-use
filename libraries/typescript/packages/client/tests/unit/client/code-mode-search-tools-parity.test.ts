import { describe, expect, it } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";
import { E2BCodeExecutor } from "../../../src/code-mode/executor-e2b.js";
import { VMCodeExecutor } from "../../../src/code-mode/executor-vm.js";
import type { MCPClient } from "../../../src/core/node.js";

function makeTool(
  name: string,
  description: string,
  properties: Record<string, unknown> = {}
): Tool {
  return {
    name,
    description,
    inputSchema: { type: "object", properties },
  } as Tool;
}

const catalogue: Record<string, Tool[]> = {
  "github-mcp": [
    makeTool("list_pull_requests", "List pull requests", {
      repo: { type: "string" },
    }),
    makeTool("get_issue", "Read an issue"),
  ],
  slack: [makeTool("post_message", "Post a message to a channel")],
};

function fakeClient(): MCPClient {
  const sessions = Object.fromEntries(
    Object.entries(catalogue).map(([serverName, tools]) => [
      serverName,
      {
        connector: {
          get tools() {
            return tools;
          },
          callTool: async () => ({ content: [] }),
        },
      },
    ])
  );
  return {
    getServerNames: () => Object.keys(catalogue),
    getAllActiveSessions: () => sessions,
  } as unknown as MCPClient;
}

type SearchFn = (
  query?: string,
  detailLevel?: "names" | "descriptions" | "full"
) => Promise<unknown>;

/** Evaluates the generated E2B shim and returns its global object. */
function e2bGlobals(executor: E2BCodeExecutor): Record<string, any> {
  const shim = (
    executor as unknown as { generateShim: (t: typeof catalogue) => string }
  ).generateShim(catalogue);
  const global: Record<string, any> = {};
  // eslint-disable-next-line no-new-func
  new Function("global", "console", shim)(global, {
    log: () => {},
    error: () => {},
    warn: () => {},
  });
  return global;
}

describe("search_tools parity between executors", () => {
  const vm = new VMCodeExecutor(fakeClient());
  const e2b = new E2BCodeExecutor({} as MCPClient, { apiKey: "test" });
  const globals = e2bGlobals(e2b);

  it("returns the same { meta, results } document as the VM executor", async () => {
    const e2bResult = await globals.search_tools("github");
    const vmResult = await (
      vm as unknown as { createSearchToolsFunction: () => SearchFn }
    ).createSearchToolsFunction()("github");

    expect(e2bResult).toEqual(vmResult);
    expect(e2bResult.meta).toEqual({
      total_tools: 3,
      namespaces: ["github-mcp", "slack"],
      result_count: 2,
    });
    expect(Array.isArray(e2bResult.results)).toBe(true);
  });

  it("matches on the server name, not only name and description", async () => {
    const result = await globals.search_tools("slack");

    expect(result.meta.result_count).toBe(1);
    expect(result.results[0]).toMatchObject({
      name: "post_message",
      server: "slack",
    });
  });

  it("searches full records before projecting to the requested level", async () => {
    // The detail level controls which fields are returned, not which tools
    // match: a description-only match is found at the `names` level too.
    // The VM executor gets the same order in #2728; on main today it still
    // projects first, so this case is deliberately not compared against it.
    const result = await globals.search_tools("Post a message", "names");

    expect(result.meta.result_count).toBe(1);
    expect(result.results).toEqual([{ name: "post_message", server: "slack" }]);
  });

  it("keeps the detail levels and their counts aligned with the VM executor", async () => {
    const vmSearch = (
      vm as unknown as { createSearchToolsFunction: () => SearchFn }
    ).createSearchToolsFunction();

    for (const level of ["names", "descriptions", "full"] as const) {
      await expect(globals.search_tools("", level)).resolves.toEqual(
        await vmSearch("", level)
      );
    }
  });
});

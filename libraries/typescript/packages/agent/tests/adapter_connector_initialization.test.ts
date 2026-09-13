import { BaseConnector } from "@mcp-use/client";
import { describe, expect, it } from "vitest";

import { LangChainAdapter } from "../src/adapters/langchain_adapter.js";

/**
 * The adapter initializes a connector on demand. It used to decide by reading
 * `connector.tools`, which throws before `initialize()` has run, so the
 * on-demand path threw instead of taking itself.
 */
class ProbeConnector extends BaseConnector {
  /** Number of completed `initialize()` calls. */
  initializeCount = 0;

  constructor(private readonly toolNames: string[]) {
    super({} as never);
    Object.assign(this as never as Record<string, unknown>, {
      client: {
        getServerCapabilities: () => ({ tools: {} }),
        getServerVersion: () => ({ name: "probe", version: "1" }),
        listTools: async () => ({
          tools: this.toolNames.map((name) => ({
            name,
            inputSchema: { type: "object" },
          })),
        }),
      },
    });
  }

  async connect(): Promise<void> {}

  override async initialize(): Promise<
    ReturnType<BaseConnector["initialize"]> extends Promise<infer R> ? R : never
  > {
    const capabilities = await super.initialize();
    this.initializeCount += 1;
    return capabilities;
  }

  get publicIdentifier(): Record<string, string> {
    return { type: "probe" };
  }
}

describe("loading tools from a connector", () => {
  it("initializes a connector that has not been initialized yet", async () => {
    const connector = new ProbeConnector(["search"]);

    const tools = await new LangChainAdapter().loadToolsForConnector(connector);

    expect(connector.initializeCount).toBe(1);
    expect(tools.map((tool) => tool.name)).toEqual(["search"]);
  });

  it("does not re-initialize a server that has no tools", async () => {
    const connector = new ProbeConnector([]);
    await connector.initialize();

    await new LangChainAdapter().loadResourcesForConnector(connector);

    expect(connector.initializeCount).toBe(1);
  });
});

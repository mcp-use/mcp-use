import { describe, expect, it, vi } from "vitest";

import { BaseAdapter } from "../../../src/adapters/base.js";
import type { BaseConnector } from "@mcp-use/client";

class TestAdapter extends BaseAdapter<any> {
  convertTool(tool: any): any {
    return tool;
  }

  async ensureConnectorInitialized(
    _connector: BaseConnector
  ): Promise<boolean> {
    return true;
  }
}

describe("BaseAdapter.loadToolsForConnector", () => {
  it("uses listAllTools when present on connector", async () => {
    const adapter = new TestAdapter();
    const listAllToolsMock = vi.fn().mockResolvedValue({
      tools: [{ name: "tool-1" }, { name: "tool-2" }],
    });

    const connector = {
      tools: [{ name: "tool-from-cache" }],
      listAllTools: listAllToolsMock,
    } as unknown as BaseConnector;

    const result = await adapter.loadToolsForConnector(connector);

    expect(result).toEqual([{ name: "tool-1" }, { name: "tool-2" }]);
    expect(listAllToolsMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to connector.tools when listAllTools is absent", async () => {
    const adapter = new TestAdapter();

    const connector = {
      tools: [{ name: "tool-from-cache" }],
    } as unknown as BaseConnector;

    const result = await adapter.loadToolsForConnector(connector);

    expect(result).toEqual([{ name: "tool-from-cache" }]);
  });
});

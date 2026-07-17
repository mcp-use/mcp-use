import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { MCPClient } from "../../../src/client.js";
import type { BaseConnector } from "../../../src/connectors/base.js";

class TestMCPClient extends MCPClient {
  createStdioConnector(
    config: Record<string, unknown>
  ): Promise<BaseConnector> {
    return this.createConnectorFromConfig(config);
  }
}

describe("MCPClient stdio configuration", () => {
  it("passes errlog through to the stdio connector", async () => {
    const errlog = new PassThrough();
    const client = new TestMCPClient();

    const connector = await client.createStdioConnector({
      command: "node",
      args: ["server.js"],
      errlog,
    });

    expect((connector as unknown as { errlog: PassThrough }).errlog).toBe(
      errlog
    );
  });
});

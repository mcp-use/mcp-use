import { describe, expect, it } from "vitest";

import { BaseConnector } from "../../../src/transport/base.js";

class TestConnector extends BaseConnector {
  async connect(): Promise<void> {}

  get publicIdentifier(): Record<string, string> {
    return { type: "test" };
  }
}

/**
 * `listAllResources` paginates inside a single `executeRequest` closure, so a
 * `disconnect()` landing between pages used to null the client the closure was
 * reading, surfacing `Cannot read properties of null` instead of the
 * transport's own error.
 */
describe("listAllResources", () => {
  it("surfaces the transport error when a disconnect lands between pages", async () => {
    const connector = new TestConnector() as BaseConnector & {
      client: unknown;
      capabilitiesCache: unknown;
    };
    connector.capabilitiesCache = { resources: {} };

    let page = 0;
    let connected = true;
    connector.client = {
      async listResources() {
        if (!connected) throw new Error("Not connected");
        page += 1;
        // The second page never arrives: the session is torn down first.
        connected = false;
        connector.client = null;
        return { resources: [{ uri: `resource-${page}` }], nextCursor: "next" };
      },
    };

    await expect(connector.listAllResources()).rejects.toThrow("Not connected");
  });
});

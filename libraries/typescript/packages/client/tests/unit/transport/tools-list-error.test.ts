import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { StdioConnector } from "../../../src/transport/stdio.js";

type FixtureMode = "method-not-found" | "internal-error" | "close";

function fixtureConnector(mode: FixtureMode): StdioConnector {
  const connector = new StdioConnector({
    command: process.execPath,
    args: [
      fileURLToPath(
        new URL("../../fixtures/tools-list-error-server.mjs", import.meta.url)
      ),
      mode,
    ],
    protocolNegotiation: "legacy",
  });
  onTestFinished(async () => {
    await connector.disconnect();
  });
  return connector;
}

describe("initialize() when tools/list fails", () => {
  it("treats method-not-found as a server without tools", async () => {
    const connector = fixtureConnector("method-not-found");
    await connector.connect();

    await expect(connector.initialize()).resolves.toBeDefined();
    expect(connector.tools).toEqual([]);
  });

  it("propagates non-method-not-found server errors without emptying the cache", async () => {
    const connector = fixtureConnector("internal-error");
    await connector.connect();

    await expect(connector.initialize()).rejects.toThrow(
      "storage backend unavailable"
    );
    // A failed initialization must not look like a successful empty tool list.
    expect(() => connector.tools).toThrow(/not initialized/);
  });

  it("propagates a transport close during tools/list", async () => {
    const connector = fixtureConnector("close");
    await connector.connect();

    await expect(connector.initialize()).rejects.toThrow("Connection closed");
  });
});

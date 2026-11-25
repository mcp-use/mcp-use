// E1 S: handshake and header pass-through (PLAN.md §18.8.4).
import { describe, expect, it } from "vitest";
import { RawClient } from "../src/raw-client.js";
import { hasFixture, toolText, useTarget } from "./fixture.js";

describe.skipIf(!hasFixture)("E1 handshake and pass-through", () => {
  const target = useTarget();

  it("C-openai initializes with its ChatGPT client name and gets serverInfo back", async () => {
    const client = new RawClient({
      url: target().mcpUrl,
      clientName: "openai-mcp/1.0",
      protocolVersion: "2025-06-18",
    });
    const result = await client.initialize();
    expect(result.serverInfo.name).toBe("ev-e2e-fixture");
  });

  it("Mcp-Name, Mcp-Param-* and User-Agent reach the app unchanged", async () => {
    const client = new RawClient({
      url: target().mcpUrl,
      clientName: "ev-e2e-sep",
      protocolVersion: "2025-06-18",
      headers: { "user-agent": "ev-e2e/1.0" },
    });
    await client.initialize();
    const res = await client.request(
      "tools/call",
      { name: "echo-request", arguments: {} },
      { "mcp-name": "echo-request", "mcp-param-folder": "inbox" }
    );
    expect(JSON.parse(toolText(res.body.result))).toMatchObject({
      "mcp-name": "echo-request",
      "mcp-param-folder": "inbox",
      "user-agent": "ev-e2e/1.0",
    });
  });

  // TODO(events): Events capability keys per era against the golden and
  // `x-mcp-use-events-dialect` once the engine advertises the extension.
});

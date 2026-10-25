/**
 * `ctx.sendLog` honours the request's log level: modern (2026-07-28) clients
 * receive log messages only when they opt in, and only at or above that level.
 */
import {
  Client,
  LOG_LEVEL_META_KEY,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MCPServer } from "../src/index.js";

describe("ctx.sendLog log level", () => {
  const server = new MCPServer({ name: "send-log-test", version: "1.0.0" });
  server.tool({ name: "emit-logs" }, async (_params, ctx) => {
    await ctx.sendLog("debug", "debug-msg");
    await ctx.sendLog("error", "error-msg");
    return { content: [{ type: "text", text: "ok" }] };
  });

  let client: Client;
  const logs: unknown[] = [];

  beforeAll(async () => {
    const { url } = await server.listen(0);
    client = new Client(
      { name: "send-log-test-client", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    client.setNotificationHandler("notifications/message", (notification) => {
      logs.push(notification.params);
    });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  });

  beforeEach(() => {
    logs.length = 0;
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("sends nothing when the request has no log level", async () => {
    await client.callTool({ name: "emit-logs" });
    expect(logs).toEqual([]);
  });

  it("drops messages below the request's log level", async () => {
    await client.callTool({
      name: "emit-logs",
      _meta: { [LOG_LEVEL_META_KEY]: "error" },
    });
    expect(logs).toEqual([{ level: "error", data: "error-msg" }]);
  });

  it("sends every message at or above the request's log level", async () => {
    await client.callTool({
      name: "emit-logs",
      _meta: { [LOG_LEVEL_META_KEY]: "debug" },
    });
    expect(logs).toEqual([
      { level: "debug", data: "debug-msg" },
      { level: "error", data: "error-msg" },
    ]);
  });
});

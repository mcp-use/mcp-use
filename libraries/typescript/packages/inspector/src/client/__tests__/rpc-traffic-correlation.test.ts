import { describe, expect, it } from "vitest";
import { buildRpcTrafficResponseLabels } from "../rpc-traffic-correlation";
import type { RpcTrafficEntry } from "../rpc-traffic-store";

const request = ({
  entryId,
  rpcId,
  method,
  direction = "send",
  timestamp = "2026-08-19T10:04:12.100Z",
  source = "mcp",
  serverId = "server-1",
  widgetId,
}: {
  entryId: string;
  rpcId: string | number;
  method: string;
  direction?: "send" | "receive";
  timestamp?: string;
  source?: "mcp" | "widget";
  serverId?: string;
  widgetId?: string;
}): RpcTrafficEntry => ({
  id: entryId,
  source,
  serverId,
  widgetId,
  direction,
  timestamp,
  message: { jsonrpc: "2.0", id: rpcId, method },
});

const response = ({
  entryId,
  rpcId,
  direction = "receive",
  timestamp = "2026-08-19T10:04:12.142Z",
  source = "mcp",
  serverId = "server-1",
  widgetId,
  error = false,
}: {
  entryId: string;
  rpcId: string | number;
  direction?: "send" | "receive";
  timestamp?: string;
  source?: "mcp" | "widget";
  serverId?: string;
  widgetId?: string;
  error?: boolean;
}): RpcTrafficEntry => ({
  id: entryId,
  source,
  serverId,
  widgetId,
  direction,
  timestamp,
  message: error
    ? { jsonrpc: "2.0", id: rpcId, error: { code: -32603 } }
    : { jsonrpc: "2.0", id: rpcId, result: {} },
});

describe("RPC traffic response correlation", () => {
  it("keeps response method, latency, and outcome separate for presentation", () => {
    const labels = buildRpcTrafficResponseLabels([
      request({ entryId: "rpc-1", rpcId: 7, method: "tools/call" }),
      response({ entryId: "rpc-2", rpcId: 7, error: true }),
    ]);

    expect(labels.get("rpc-2")).toEqual({
      method: "tools/call",
      latencyMs: 42,
      outcome: "error",
    });
  });

  it("labels successful responses with the request method and latency", () => {
    const labels = buildRpcTrafficResponseLabels([
      request({ entryId: "rpc-1", rpcId: 7, method: "tools/call" }),
      response({ entryId: "rpc-2", rpcId: 7 }),
    ]);

    expect(labels.get("rpc-2")).toEqual({
      method: "tools/call",
      latencyMs: 42,
      outcome: "result",
    });
  });

  it("keeps correlated error responses distinguishable", () => {
    const labels = buildRpcTrafficResponseLabels([
      request({ entryId: "rpc-1", rpcId: 7, method: "tools/call" }),
      response({ entryId: "rpc-2", rpcId: 7, error: true }),
    ]);

    expect(labels.get("rpc-2")).toEqual({
      method: "tools/call",
      latencyMs: 42,
      outcome: "error",
    });
  });

  it("matches simultaneous bidirectional requests with the same id", () => {
    const labels = buildRpcTrafficResponseLabels([
      request({ entryId: "rpc-1", rpcId: 1, method: "tools/call" }),
      request({
        entryId: "rpc-2",
        rpcId: 1,
        method: "sampling/createMessage",
        direction: "receive",
        timestamp: "2026-08-19T10:04:12.110Z",
      }),
      response({
        entryId: "rpc-3",
        rpcId: 1,
        timestamp: "2026-08-19T10:04:12.150Z",
      }),
      response({
        entryId: "rpc-4",
        rpcId: 1,
        direction: "send",
        timestamp: "2026-08-19T10:04:12.180Z",
      }),
    ]);

    expect([...labels]).toEqual([
      ["rpc-3", { method: "tools/call", latencyMs: 50, outcome: "result" }],
      [
        "rpc-4",
        {
          method: "sampling/createMessage",
          latencyMs: 70,
          outcome: "result",
        },
      ],
    ]);
  });

  it("isolates correlations by source, server, widget, and id type", () => {
    const labels = buildRpcTrafficResponseLabels([
      request({ entryId: "rpc-1", rpcId: 1, method: "numeric" }),
      request({ entryId: "rpc-2", rpcId: "1", method: "string" }),
      request({
        entryId: "rpc-3",
        rpcId: 1,
        method: "other-server",
        serverId: "server-2",
      }),
      request({
        entryId: "rpc-4",
        rpcId: 1,
        method: "widget-call",
        source: "widget",
        widgetId: "widget-1",
      }),
      response({ entryId: "rpc-5", rpcId: "1" }),
      response({ entryId: "rpc-6", rpcId: 1, serverId: "server-2" }),
      response({
        entryId: "rpc-7",
        rpcId: 1,
        source: "widget",
        widgetId: "widget-1",
      }),
      response({ entryId: "rpc-8", rpcId: 1 }),
    ]);

    expect([...labels.values()]).toEqual([
      { method: "string", latencyMs: 42, outcome: "result" },
      { method: "other-server", latencyMs: 42, outcome: "result" },
      { method: "widget-call", latencyMs: 42, outcome: "result" },
      { method: "numeric", latencyMs: 42, outcome: "result" },
    ]);
  });
});

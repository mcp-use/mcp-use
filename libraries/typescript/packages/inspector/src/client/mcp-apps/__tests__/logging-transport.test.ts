import type { JSONRPCMessage, Transport } from "@mcp-use/client/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rpcTrafficStore } from "../../rpc-traffic-store";
import { wrapTransportWithLogging } from "../logging-transport";

describe("wrapTransportWithLogging", () => {
  beforeEach(() => rpcTrafficStore.clear());

  it("attributes widget send and receive traffic to the real server", async () => {
    const inner = {
      start: vi.fn(async () => {}),
      send: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      onmessage: undefined,
    } as unknown as Transport;
    const wrapped = wrapTransportWithLogging(inner, "server-1", "call-42");
    const received = vi.fn();
    wrapped.onmessage = received;

    const outbound = {
      jsonrpc: "2.0",
      id: 1,
      method: "ui/initialize",
    } as JSONRPCMessage;
    const inbound = {
      jsonrpc: "2.0",
      id: 1,
      result: {},
    } as JSONRPCMessage;

    await wrapped.send(outbound);
    inner.onmessage?.(inbound);

    expect(received).toHaveBeenCalledWith(inbound, undefined);
    expect(rpcTrafficStore.getSnapshot()).toMatchObject([
      {
        source: "widget",
        serverId: "server-1",
        widgetId: "call-42",
        direction: "send",
        message: outbound,
      },
      {
        source: "widget",
        serverId: "server-1",
        widgetId: "call-42",
        direction: "receive",
        message: inbound,
      },
    ]);
  });
});

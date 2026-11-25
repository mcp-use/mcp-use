import { EventsError } from "@mcp-use/events-core";
import { describe, expect, it } from "vitest";
import { createManualClock } from "../../../src/events/internal/clock.js";
import type { LogValue } from "../../../src/events/internal/records.js";
import { LogTail } from "../../../src/events/responder/logtail.js";
import {
  StreamRegistry,
  grantHeartbeat,
  handleStream,
  type StreamDeps,
} from "../../../src/events/responder/stream.js";
import { codec, event, memoryLog, registry } from "../engine/fixtures.js";

const ev = (data: unknown, extra: Record<string, unknown> = {}): LogValue => ({
  v: 1, k: "e", id: `id${JSON.stringify(data)}`, ts: "2026-11-25T10:00:00.000Z", at: 0, data, partition: null, ...extra,
});

function setup(over: Partial<StreamDeps> = {}) {
  const log = memoryLog();
  const clock = createManualClock(0);
  const tail = new LogTail({ backend: log, clock });
  const deps: StreamDeps = {
    registry: registry(event("n")),
    backend: log,
    env: { webhookPrincipalSource: true, pollEnabled: true, pushEnabled: true },
    era: "modern",
    listedModes: "servable",
    isDormant: () => false,
    isVisible: async () => true,
    validateArgs: async (_e, a) => a,
    principal: () => "iss|alice",
    authorize: async () => true,
    isClosed: async () => false,
    codec,
    tail,
    clock,
    streams: new StreamRegistry(),
    maxDurationMs: 0,
    pollIntervalMs: 10_000,
    onSubscribe: async () => {},
    toJsonRpc: (e) => ({ code: -32024, message: e.message, ...(e.data ? { data: e.data } : {}) }),
    ...over,
  };
  return { log, clock, tail, deps };
}

/** Reads SSE frames as parsed JSON-RPC messages until `n` frames or the stream ends. */
async function frames(res: Response, n: number) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  const out: Array<Record<string, any>> = [];
  while (out.length < n) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
    let i: number;
    while ((i = text.indexOf("\n\n")) >= 0) {
      const chunk = text.slice(0, i);
      text = text.slice(i + 2);
      expect(chunk.split("\n")[0]).toBe("event: message");
      expect(chunk).not.toMatch(/^(id:|:)/m);
      out.push(JSON.parse(chunk.split("\n")[1]!.slice(6)));
    }
  }
  reader.releaseLock();
  return { out, reader: res.body! };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("events/stream responder (D52)", () => {
  it("sends active first, catches up from the cursor, then goes live without duplicates", async () => {
    const { log, tail, deps } = setup();
    log.append("n", ev({ i: 1 }));
    log.append("n", ev({ i: 2 }));
    const res = await handleStream(7, { name: "n", cursor: "c.e1.1", heartbeatMs: 1000 }, deps);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    log.append("n", ev({ i: 3 }, { meta: { "vendor/x": 1, "io.modelcontextprotocol/subscriptionId": "spoof" } }));
    await flush();
    await tail.poll();
    const { out } = await frames(res, 3);
    expect(out[0]).toEqual({
      jsonrpc: "2.0",
      method: "notifications/events/active",
      params: { cursor: "c.e1.1", truncated: false, heartbeatMs: 5000, _meta: { "io.modelcontextprotocol/subscriptionId": 7 } },
    });
    expect(out.slice(1).map((f) => [f.params.data, f.params.cursor])).toEqual([
      [{ i: 2 }, "c.e1.2"],
      [{ i: 3 }, "c.e1.3"],
    ]);
    expect(out[2]!.params._meta).toEqual({ "vendor/x": 1, "io.modelcontextprotocol/subscriptionId": 7 });
  });

  it("heartbeats with the advancing cursor when nothing matches", async () => {
    const { log, tail, clock, deps } = setup();
    const res = await handleStream(1, { name: "n", arguments: { i: 9 }, heartbeatMs: 5000 }, deps);
    await flush();
    log.append("n", ev({ i: 1 }));
    await tail.poll();
    await flush();
    await clock.advance(5000);
    await flush();
    const { out } = await frames(res, 2);
    expect(out[1]).toEqual({
      jsonrpc: "2.0",
      method: "notifications/events/heartbeat",
      params: { cursor: "c.e1.1", _meta: { "io.modelcontextprotocol/subscriptionId": 1 } },
    });
  });

  it("terminates on a targeting control entry with a final result frame", async () => {
    const { log, tail, deps } = setup();
    const res = await handleStream("r", { name: "n" }, deps);
    await flush();
    log.append("n", { v: 1, k: "t", at: 0, to: { principals: ["iss|alice"] }, error: { kind: "forbidden", message: "Forbidden", data: { reason: "revoked" } } });
    await tail.poll();
    await flush();
    const { out } = await frames(res, 5);
    expect(out.map((f) => f.method ?? "result")).toEqual(["notifications/events/active", "notifications/events/terminated", "result"]);
    expect(out[1]!.params.error).toEqual({ code: -32024, message: "Forbidden", data: { reason: "revoked" } });
    expect(deps.streams.size).toBe(0);
  });

  it("rotates gracefully at the max duration", async () => {
    const { clock, deps } = setup({ maxDurationMs: 120_000 });
    const res = await handleStream(1, { name: "n", heartbeatMs: 55_000 }, deps);
    await flush();
    await clock.advance(120_000);
    await flush();
    const { out } = await frames(res, 9);
    expect(out.map((f) => f.method ?? "result").slice(-2)).toEqual(["notifications/events/heartbeat", "result"]);
  });

  it("sends a fresh truncated active when the log is trimmed mid-stream", async () => {
    const { log, tail, deps } = setup();
    const res = await handleStream(1, { name: "n" }, deps);
    await flush();
    for (let i = 0; i < 5; i++) log.append("n", ev({ i }, { to: { principals: ["nobody"] } }));
    log.trim("n", 4);
    await tail.poll();
    await flush();
    const { out } = await frames(res, 2);
    expect(out[1]!.params).toMatchObject({ cursor: "c.e1.3", truncated: true });
  });

  it("caps streams per principal and validates before opening", async () => {
    const { deps } = setup({ streams: new StreamRegistry(1, 10) });
    await handleStream(1, { name: "n" }, deps);
    await expect(handleStream(2, { name: "n" }, deps)).rejects.toMatchObject({ kind: "resourceExhausted", data: { limit: "streams", max: 1 } });
    await expect(handleStream(3, { name: "zz" }, deps)).rejects.toBeInstanceOf(EventsError);
  });

  it("clamps the heartbeat grant", () => {
    expect([grantHeartbeat(undefined), grantHeartbeat(1), grantHeartbeat(999_999), grantHeartbeat(999_999, 40_000)]).toEqual([30_000, 5000, 55_000, 40_000]);
  });
});

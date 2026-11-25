import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { MCPServer } from "../../../src/index.js";
import {
  installEventsDev,
  resetEventsDev,
} from "../../../src/events/dev/index.js";
import { createTestReceiver } from "../../../src/events/testing/receiver.js";
import { memoryStorage } from "../../../src/storage/adapters/memory.js";
import type { McpUseStorage } from "../../../src/storage/types.js";
import { MODERN_META } from "../wire/helpers.js";

let servers: MCPServer[] = [];

afterEach(async () => {
  for (const s of servers) await s.close();
  servers = [];
  resetEventsDev();
});

/** A Standard Webhooks secret built at runtime (never one literal). */
const whsec = () => `whsec_${Buffer.alloc(32, 7).toString("base64")}`;

function makeServer(config: Record<string, unknown> = {}): MCPServer {
  const server = new MCPServer({
    name: "wiring",
    version: "1.0.0",
    ...config,
  } as never);
  server.event({
    name: "note.created",
    description: "A note was created",
    payloadSchema: z.object({ id: z.string() }),
  } as never);
  servers.push(server);
  return server;
}

function rpcRequest(
  base: string,
  method: string,
  params: Record<string, unknown>,
  id: number | string = 1
): Request {
  return new Request(`${base}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(typeof params.name === "string" && { "mcp-name": params.name }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: { ...params, _meta: MODERN_META },
    }),
  });
}

async function rpc(
  server: MCPServer,
  method: string,
  params: Record<string, unknown>
) {
  const res = await server.fetch(
    rpcRequest("http://localhost", method, params)
  );
  return { status: res.status, json: (await res.json()) as any };
}

/** Reads SSE frames from a stream response, one at a time. */
function frameReader(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  return {
    async next(timeoutMs = 5_000): Promise<Record<string, any>> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const i = text.indexOf("\n\n");
        if (i >= 0) {
          const chunk = text.slice(0, i);
          text = text.slice(i + 2);
          const data = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (data !== undefined) return JSON.parse(data.slice(6));
          continue;
        }
        const left = deadline - Date.now();
        if (left <= 0) throw new Error("no frame before timeout");
        const r = await Promise.race([
          reader.read(),
          new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), left)
          ),
        ]);
        if (r === "timeout") throw new Error("no frame before timeout");
        if (r.done) throw new Error("stream ended");
        text += dec.decode(r.value);
      }
    },
    cancel: () => reader.cancel(),
  };
}

describe("events/stream over server.fetch", () => {
  it("sends active, then events emitted after it opened", async () => {
    const server = makeServer();
    const res = await server.fetch(
      rpcRequest(
        "http://localhost",
        "events/stream",
        { name: "note.created", arguments: {} },
        "s1"
      )
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const frames = frameReader(res);
    const active = await frames.next();
    expect(active.method).toBe("notifications/events/active");

    await server.events.emit("note.created", { id: "live-1" });
    const ev = await frames.next();
    expect(ev.method).toBe("notifications/events/event");
    expect(ev.params.data).toEqual({ id: "live-1" });
    expect(ev.params.name).toBe("note.created");
    await frames.cancel();
  });

  it("catches up from a poll cursor before going live", async () => {
    const server = makeServer();
    const first = await rpc(server, "events/poll", {
      name: "note.created",
      arguments: {},
    });
    const cursor = first.json.result.cursor as string;
    await server.events.emit("note.created", { id: "missed-1" });

    const res = await server.fetch(
      rpcRequest(
        "http://localhost",
        "events/stream",
        { name: "note.created", arguments: {}, cursor },
        "s2"
      )
    );
    const frames = frameReader(res);
    expect((await frames.next()).method).toBe("notifications/events/active");
    expect((await frames.next()).params.data).toEqual({ id: "missed-1" });
    await server.events.emit("note.created", { id: "live-2" });
    expect((await frames.next()).params.data).toEqual({ id: "live-2" });
    await frames.cancel();
  });

  it("answers an unknown event with a JSON-RPC error, not a stream", async () => {
    const server = makeServer();
    const r = await rpc(server, "events/stream", {
      name: "nope",
      arguments: {},
    });
    expect(r.json.result).toBeUndefined();
    expect(typeof r.json.error.code).toBe("number");
  });
});

describe("internal events routes", () => {
  const route = (server: MCPServer, path: string, bearer?: string) =>
    server.fetch(
      new Request(`http://localhost/mcp/_mcp-use/events/${path}`, {
        headers:
          bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
      })
    );

  it("are disabled (404) when no secret is configured", async () => {
    const server = makeServer();
    expect((await route(server, "health", "anything")).status).toBe(404);
  });

  it("require the admin secret for health and accept it", async () => {
    const admin = `adm_${"a".repeat(24)}`;
    const server = makeServer({ events: { admin: { secret: admin } } });
    expect((await route(server, "health")).status).toBe(401);
    expect((await route(server, "health", "wrong")).status).toBe(401);
    const ok = await route(server, "health", admin);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ subscriptions: 0 });
  });

  it("accept the tick secret on tick only", async () => {
    const tick = `tck_${"t".repeat(24)}`;
    const server = makeServer({
      events: {
        admin: { secret: `adm_${"b".repeat(24)}` },
        tick: { secret: tick },
      },
    });
    const ok = await route(server, "tick", tick);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ attempted: 0 });
    expect((await route(server, "health", tick)).status).toBe(401);
  });

  it("accept the dev token under the dev runtime", async () => {
    installEventsDev({
      stateDir: mkdtempSync(join(tmpdir(), "events-routes-")),
      devPort: 1,
      basePath: "",
      token: "dev-token-123",
    });
    const server = makeServer();
    expect((await route(server, "health", "dev-token-123")).status).toBe(200);
    expect((await route(server, "health", "other")).status).toBe(401);
  });

  it("emit a test event that a poller receives", async () => {
    const admin = `adm_${"c".repeat(24)}`;
    const server = makeServer({ events: { admin: { secret: admin } } });
    const first = await rpc(server, "events/poll", {
      name: "note.created",
      arguments: {},
    });
    const res = await server.fetch(
      new Request("http://localhost/mcp/_mcp-use/events/emit", {
        method: "POST",
        headers: {
          authorization: `Bearer ${admin}`,
          "content-type": "application/json",
          "x-mcp-use-confirm": "mcp-use",
        },
        body: JSON.stringify({ name: "note.created", data: { id: "route-1" } }),
      })
    );
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.eventId).toMatch(/^test_/);
    const second = await rpc(server, "events/poll", {
      name: "note.created",
      arguments: {},
      cursor: first.json.result.cursor,
    });
    expect(second.json.result.events.map((e: any) => e.data)).toEqual([
      { id: "route-1" },
    ]);
  });
});

/** Records every raw value appended to a log of a real memory store. */
function recordingStorage(): { storage: McpUseStorage; appended: string[] } {
  const storage = memoryStorage();
  const appended: string[] = [];
  const logAppend = storage.logAppend.bind(storage);
  storage.logAppend = (key, value, o) => {
    appended.push(value);
    return logAppend(key, value, o);
  };
  return { storage, appended };
}

describe("webhook delivery with a dev inbox", () => {
  async function devServer(port: number, events: Record<string, unknown> = {}) {
    const receiver = await createTestReceiver({ host: "127.0.0.1" });
    const dev = installEventsDev({
      stateDir: mkdtempSync(join(tmpdir(), "events-wiring-")),
      devPort: receiver.port,
      basePath: "",
      token: "dev-token",
    });
    const server = makeServer({ events });
    await server.listen(port);
    const call = async (method: string, params: Record<string, unknown>) => {
      const res = await fetch(
        rpcRequest(`http://127.0.0.1:${port}`, method, params)
      );
      return (await res.json()) as any;
    };
    const sub = await call("events/subscribe", {
      name: "note.created",
      arguments: {},
      delivery: {
        mode: "webhook",
        url: `${dev.trustedCallbackPrefix()}inbox1`,
        secret: whsec(),
      },
    });
    expect(sub.error).toBeUndefined();
    return { server, receiver, call };
  }

  it("hands out a body cursor that resumes events/poll after it", async () => {
    const { server, receiver, call } = await devServer(39_531);
    try {
      await server.events.emit("note.created", { id: "w1" });
      const [delivery] = await receiver.waitFor(1, 10_000);
      const body = JSON.parse(delivery!.body);
      expect(body.data).toEqual({ id: "w1" });
      expect(typeof body.cursor).toBe("string");

      await server.events.emit("note.created", { id: "w2" });
      const polled = await call("events/poll", {
        name: "note.created",
        arguments: {},
        cursor: body.cursor,
      });
      expect(polled.error).toBeUndefined();
      expect(polled.result.truncated).toBe(false);
      expect(polled.result.events.map((e: any) => e.data)).toEqual([
        { id: "w2" },
      ]);
    } finally {
      await receiver.close();
    }
  }, 20_000);

  it("seals log entries with a keyring and still delivers and polls them", async () => {
    const { storage, appended } = recordingStorage();
    const { server, receiver, call } = await devServer(39_532, {
      storage,
      secret: `k_${"s".repeat(40)}`,
    });
    try {
      const first = await call("events/poll", {
        name: "note.created",
        arguments: {},
      });
      await server.events.emit("note.created", { id: "sealed-marker-1" });
      const [delivery] = await receiver.waitFor(1, 10_000);
      expect(JSON.parse(delivery!.body).data).toEqual({
        id: "sealed-marker-1",
      });
      expect(appended.length).toBe(1);
      expect(appended[0]).not.toContain("sealed-marker-1");

      const polled = await call("events/poll", {
        name: "note.created",
        arguments: {},
        cursor: first.result.cursor,
      });
      expect(polled.result.events.map((e: any) => e.data)).toEqual([
        { id: "sealed-marker-1" },
      ]);
    } finally {
      await receiver.close();
    }
  }, 20_000);

  it("stores log entries in plaintext without a keyring", async () => {
    const { storage, appended } = recordingStorage();
    const { server, receiver } = await devServer(39_533, { storage });
    try {
      await server.events.emit("note.created", { id: "plain-marker-1" });
      await receiver.waitFor(1, 10_000);
      expect(appended.length).toBe(1);
      expect(appended[0]).toContain("plain-marker-1");
    } finally {
      await receiver.close();
    }
  }, 20_000);
});

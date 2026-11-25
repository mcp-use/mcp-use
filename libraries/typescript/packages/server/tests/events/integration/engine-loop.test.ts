import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { MCPServer } from "../../../src/index.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installEventsDev,
  resetEventsDev,
} from "../../../src/events/dev/index.js";
import { createTestReceiver } from "../../../src/events/testing/receiver.js";
import { MODERN_META } from "../wire/helpers.js";

const PORT = 39_517;
let server: MCPServer | undefined;

afterEach(async () => {
  await (server as unknown as { close?: () => Promise<void> })?.close?.();
  server = undefined;
  resetEventsDev();
});

async function rpc(method: string, params: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
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
      id: 1,
      method,
      params: { ...params, _meta: MODERN_META },
    }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("engine loop over listen()", () => {
  it("polls an emitted event from a memory binding", async () => {
    server = new MCPServer({ name: "loop", version: "1.0.0" });
    server.event({
      name: "note.created",
      description: "A note was created",
      payloadSchema: z.object({ id: z.string() }),
    } as never);
    await server.listen(PORT);

    const first = await rpc("events/poll", {
      name: "note.created",
      arguments: {},
    });
    expect(first.status).toBe(200);
    expect(first.json.error).toBeUndefined();
    expect(first.json.result.events).toEqual([]);
    const cursor = first.json.result.cursor as string;

    await server.events.emit("note.created", { id: "n1" });

    const second = await rpc("events/poll", {
      name: "note.created",
      arguments: {},
      cursor,
    });
    expect(second.json.error).toBeUndefined();
    expect(second.json.result.events.map((e: any) => e.data)).toEqual([
      { id: "n1" },
    ]);
  });

  it("polls from a cursor taken in the middle of the log", async () => {
    server = new MCPServer({ name: "loop", version: "1.0.0" });
    server.event({
      name: "note.created",
      description: "A note was created",
      payloadSchema: z.object({ id: z.string() }),
    } as never);
    await server.listen(PORT);

    await server.events.emit("note.created", { id: "n1" });
    const first = await rpc("events/poll", {
      name: "note.created",
      arguments: {},
    });
    expect(first.json.result.events).toEqual([]);
    const cursor = first.json.result.cursor as string;

    await server.events.emit("note.created", { id: "n2" });
    const second = await rpc("events/poll", {
      name: "note.created",
      arguments: {},
      cursor,
    });
    expect(second.json.error).toBeUndefined();
    expect(second.json.result.truncated).toBe(false);
    expect(second.json.result.events.map((e: any) => e.data)).toEqual([
      { id: "n2" },
    ]);
  });

  it("streams an event emitted after the stream opened", async () => {
    server = new MCPServer({ name: "loop", version: "1.0.0" });
    server.event({
      name: "note.created",
      description: "A note was created",
      payloadSchema: z.object({ id: z.string() }),
    } as never);
    await server.listen(PORT);

    const abort = new AbortController();
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: "POST",
      signal: abort.signal,
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "events/stream",
        "mcp-name": "note.created",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "events/stream",
        params: { name: "note.created", arguments: {}, _meta: MODERN_META },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const methods = (): string[] =>
      [...text.matchAll(/^data: (.*)$/gm)].map(
        (m) => (JSON.parse(m[1]!) as { method?: string }).method ?? "result"
      );
    const readUntil = async (method: string) => {
      while (!methods().includes(method)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    };

    await readUntil("notifications/events/active");
    await server.events.emit("note.created", { id: "n1" });
    await readUntil("notifications/events/event");
    abort.abort();

    expect(methods()).toEqual([
      "notifications/events/active",
      "notifications/events/event",
    ]);
    const event = [...text.matchAll(/^data: (.*)$/gm)]
      .map((m) => JSON.parse(m[1]!) as { method: string; params: any })
      .find((f) => f.method === "notifications/events/event")!;
    expect(event.params.data).toEqual({ id: "n1" });
    expect(event.params._meta["io.modelcontextprotocol/subscriptionId"]).toBe(
      7
    );
  });

  it("delivers an emitted event to the dev inbox webhook", async () => {
    const receiver = await createTestReceiver({ host: "127.0.0.1" });
    try {
      const dev = installEventsDev({
        stateDir: mkdtempSync(join(tmpdir(), "events-loop-")),
        devPort: receiver.port,
        basePath: "",
        token: "dev-token",
      });
      server = new MCPServer({ name: "loop", version: "1.0.0" });
      server.event({
        name: "note.created",
        description: "A note was created",
        payloadSchema: z.object({ id: z.string() }),
      } as never);
      await server.listen(PORT);

      const sub = await rpc("events/subscribe", {
        name: "note.created",
        arguments: {},
        delivery: {
          mode: "webhook",
          url: `${dev.trustedCallbackPrefix()}inbox1`,
          secret: `whsec_${Buffer.alloc(32, 7).toString("base64")}`,
        },
      });
      expect(sub.json.error).toBeUndefined();
      expect(sub.json.result.id).toMatch(/^sub_/);

      await server.events.emit("note.created", { id: "n2" });
      const [delivery] = await receiver.waitFor(1, 10_000);
      expect(delivery!.path).toBe("/inspector/api/events/hooks/inbox1");
      expect(JSON.parse(delivery!.body).data).toEqual({ id: "n2" });
    } finally {
      await receiver.close();
    }
  }, 20_000);
});

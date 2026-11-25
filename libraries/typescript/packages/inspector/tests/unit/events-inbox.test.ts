import { parseWebhookSecret, signWebhook } from "@mcp-use/events-core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mountEventsInboxRoutes } from "../../src/server/events/hook-routes.js";
import {
  StorageEventsInbox,
  localInboxStorage,
  type InboxStorage,
} from "../../src/server/events/inbox-store.js";
import { registerInspectorProxyRoutes } from "../../src/server/proxy-routes.js";
import { singleHeaderValue } from "../../src/server/proxy/mcp-proxy.js";

const ORIGIN = "http://localhost:3000";

function inspectorApp(storage: InboxStorage): Hono {
  const app = new Hono();
  mountEventsInboxRoutes(app, {
    inbox: new StorageEventsInbox({ storage }),
  });
  return app;
}

async function createInbox(app: Hono) {
  const res = await app.request(`${ORIGIN}/inspector/api/events/inboxes`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ profile: "sep-3415" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as {
    inboxId: string;
    callbackUrl: string;
    secret: string;
    readToken: string;
  };
}

async function signedHook(
  app: Hono,
  inboxId: string,
  secret: string,
  body: unknown,
  webhookId = "evt_1"
) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const ts = Math.floor(Date.now() / 1000);
  const signature = await signWebhook(
    [parseWebhookSecret(secret)!],
    webhookId,
    ts,
    bytes
  );
  return app.request(`${ORIGIN}/inspector/api/events/hooks/${inboxId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": String(ts),
      "webhook-signature": signature,
      "X-MCP-Subscription-Id": "sub_1",
    },
    body: bytes,
  });
}

async function readFrames(res: Response, count: number): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const frames: string[] = [];
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
    const parts = text.split("\n\n");
    text = parts.pop()!;
    for (const part of parts) {
      if (part.includes("event: delivery")) frames.push(part);
    }
  }
  await reader.cancel();
  return frames;
}

const EVENT = {
  eventId: "evt_1",
  name: "note.created",
  timestamp: "2026-11-25T12:00:00.000Z",
  data: { noteId: "n1" },
  cursor: "c1",
};

describe("Inspector Events inbox", () => {
  it("streams from one instance a hook accepted by another on a shared store", async () => {
    const shared = localInboxStorage();
    const a = inspectorApp(shared);
    const b = inspectorApp(shared);
    const inbox = await createInbox(a);
    expect(inbox.callbackUrl).toBe(
      `${ORIGIN}/inspector/api/events/hooks/${inbox.inboxId}`
    );
    expect(inbox.secret.startsWith("whsec_")).toBe(true);

    const hook = await signedHook(b, inbox.inboxId, inbox.secret, EVENT);
    expect(hook.status).toBe(200);

    const stream = await a.request(
      `${ORIGIN}/inspector/api/events/inboxes/${inbox.inboxId}/stream?token=${inbox.readToken}`
    );
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    const [frame] = await readFrames(stream, 1);
    const data = JSON.parse(frame!.split("data: ")[1]!);
    expect(data.seq).toBe(1);
    expect(data.delivery.kind).toBe("event");
    expect(data.delivery.response).toEqual({ status: 200 });
    expect(
      data.delivery.checks.map((c: { id: string; ok: boolean }) => [c.id, c.ok])
    ).toEqual([
      ["size", true],
      ["webhook-id", true],
      ["subscription-id-header", true],
      ["signature", true],
      ["timestamp", true],
      ["json", true],
      ["cursor-field", true],
      ["timestamp-field", true],
      ["webhook-id-vs-eventId", true],
    ]);
  });

  it("wakes an open stream when a delivery arrives", async () => {
    const app = inspectorApp(localInboxStorage());
    const inbox = await createInbox(app);
    const stream = await app.request(
      `${ORIGIN}/inspector/api/events/inboxes/${inbox.inboxId}/stream?token=${inbox.readToken}`
    );
    const frames = readFrames(stream, 1);
    await signedHook(app, inbox.inboxId, inbox.secret, EVENT);
    const [frame] = await frames;
    expect(frame).toContain("id: 1\nevent: delivery");
  });

  it("records a signature failure as a check row and answers 401, not 5xx", async () => {
    const storage = localInboxStorage();
    const app = inspectorApp(storage);
    const inbox = await createInbox(app);
    const wrong = "whsec_" + Buffer.alloc(32, 7).toString("base64");
    const res = await signedHook(app, inbox.inboxId, wrong, EVENT);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid signature" });

    const store = new StorageEventsInbox({ storage });
    const { entries } = await store.read(inbox.inboxId, null);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.delivery.response).toEqual({ status: 401 });
    expect(
      entries[0]!.delivery.checks.find((c) => c.id === "signature")
    ).toEqual({
      id: "signature",
      level: "MUST",
      ok: false,
      detail: "invalid_signature",
    });
  });

  it("echoes the verification challenge exactly", async () => {
    const app = inspectorApp(localInboxStorage());
    const inbox = await createInbox(app);
    const res = await signedHook(
      app,
      inbox.inboxId,
      inbox.secret,
      { type: "verification", challenge: "nonce-123" },
      "msg_verification_1"
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"challenge":"nonce-123"}');
  });

  it("stores a repeated (subscription, webhook-id) once", async () => {
    const storage = localInboxStorage();
    const app = inspectorApp(storage);
    const inbox = await createInbox(app);
    expect(
      (await signedHook(app, inbox.inboxId, inbox.secret, EVENT)).status
    ).toBe(200);
    expect(
      (await signedHook(app, inbox.inboxId, inbox.secret, EVENT)).status
    ).toBe(200);
    const { entries } = await new StorageEventsInbox({ storage }).read(
      inbox.inboxId,
      null
    );
    expect(entries.map((e) => e.seq)).toEqual([1]);
  });

  it("limits each inbox to 600 hooks per minute", async () => {
    const storage = localInboxStorage();
    const now = () => Date.UTC(2026, 10, 25, 12, 0, 30);
    const inbox = new StorageEventsInbox({ storage, now });
    const created = await inbox.create();
    for (let i = 0; i < 600; i += 1) {
      await storage.incr(
        `insp:rl:${created.inboxId}:${Math.floor(now() / 60_000)}`,
        {
          ttlMs: 120_000,
        }
      );
    }
    const result = await inbox.receive(
      created.inboxId,
      new Headers(),
      new Uint8Array(0)
    );
    expect(result.status).toBe(429);
    expect(result.headers).toEqual({ "Retry-After": "30" });
  });

  it("applies a fault preset a fixed number of times", async () => {
    const app = inspectorApp(localInboxStorage());
    const inbox = await createInbox(app);
    const patch = await app.request(
      `${ORIGIN}/inspector/api/events/inboxes/${inbox.inboxId}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${inbox.readToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ fault: { type: "status-500", remaining: 1 } }),
      }
    );
    expect(patch.status).toBe(200);
    expect(
      (await signedHook(app, inbox.inboxId, inbox.secret, EVENT, "a")).status
    ).toBe(500);
    expect(
      (await signedHook(app, inbox.inboxId, inbox.secret, EVENT, "b")).status
    ).toBe(200);
  });

  it("refuses cross-origin inbox creation and a wrong read token", async () => {
    const app = inspectorApp(localInboxStorage());
    const cross = await app.request(`${ORIGIN}/inspector/api/events/inboxes`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(cross.status).toBe(403);
    const inbox = await createInbox(app);
    const stream = await app.request(
      `${ORIGIN}/inspector/api/events/inboxes/${inbox.inboxId}/stream?token=nope`
    );
    expect(stream.status).toBe(404);
  });

  it("answers 413 for a body over 262,144 bytes", async () => {
    const app = inspectorApp(localInboxStorage());
    const inbox = await createInbox(app);
    const res = await signedHook(app, inbox.inboxId, inbox.secret, {
      ...EVENT,
      data: "x".repeat(262_145),
    });
    expect(res.status).toBe(413);
  });

  it("reports the inspector version and the events-inbox capability", async () => {
    const app = new Hono();
    registerInspectorProxyRoutes(app, {
      eventsInbox: new StorageEventsInbox({ storage: localInboxStorage() }),
    });
    const version = await app.request("/inspector/api/version");
    const body = (await version.json()) as { sdk: { bundled: unknown } };
    expect(Object.keys(body)).toEqual(["version", "sdk"]);
    expect(body.sdk).toEqual({ bundled: null });
    const health = await app.request("/inspector/health");
    expect(
      ((await health.json()) as { capabilities: string[] }).capabilities
    ).toEqual(["view-preview", "events-inbox"]);
  });

  it("sends exactly one value of a repeated Mcp-Name upstream", () => {
    expect(singleHeaderValue("notes, notes")).toBe("notes");
    expect(singleHeaderValue("a,b")).toBe("a,b");
  });
});

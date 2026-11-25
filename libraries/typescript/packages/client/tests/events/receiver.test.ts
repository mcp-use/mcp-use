import { describe, expect, it } from "vitest";
import { parseWebhookSecret, signWebhook } from "@mcp-use/events-core";
import {
  createWebhookHandler,
  generateWebhookSecret,
  verifyWebhookRequest,
} from "../../src/events/webhooks.js";

const SECRET = generateWebhookSecret();

async function delivery(
  body: unknown,
  opts: { id?: string; secret?: string; sub?: string; ts?: number } = {}
): Promise<Request> {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const id = opts.id ?? "msg_1";
  const sig = await signWebhook(
    [parseWebhookSecret(opts.secret ?? SECRET)!],
    id,
    ts,
    bytes
  );
  return new Request("http://r/hook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": sig,
      "X-MCP-Subscription-Id": opts.sub ?? "sub_1",
    },
    body: bytes,
  });
}

const EVENT = {
  eventId: "e1",
  name: "note.created",
  timestamp: "2026-11-25T00:00:00.000Z",
  data: { n: 1 },
  cursor: "c1",
};

function handler(state: "active" | "pending" | "cancelled" = "active") {
  const log: string[] = [];
  let fail = false;
  const h = createWebhookHandler({
    resolve: async (id) =>
      id === "sub_1" ? { state, secrets: [SECRET] } : undefined,
    onEvent: async (e) => {
      if (fail) throw new Error("boom");
      log.push(`event:${e.eventId}`);
    },
    onCursor: async ({ cursor }) => void log.push(`cursor:${cursor}`),
    onGap: async ({ cursor }) => void log.push(`gap:${cursor}`),
    onTerminated: async ({ error }) =>
      void log.push(`terminated:${error.code}`),
  });
  return { h, log, setFail: (v: boolean) => (fail = v) };
}

describe("createWebhookHandler", () => {
  it("delivers, then persists the cursor, then answers 200; a duplicate is not re-dispatched", async () => {
    const { h, log } = handler();
    expect((await h(await delivery(EVENT))).status).toBe(200);
    expect((await h(await delivery(EVENT))).status).toBe(200);
    expect((await h(await delivery(EVENT, { id: "msg_2" }))).status).toBe(200);
    expect(log).toEqual(["event:e1", "cursor:c1"]);
  });

  it("answers 401 for a bad signature, 400 for missing headers, 410 for unknown, 503 for pending", async () => {
    expect(
      (
        await handler().h(
          await delivery(EVENT, { secret: generateWebhookSecret() })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await handler().h(
          new Request("http://r", { method: "POST", body: "{}" })
        )
      ).status
    ).toBe(400);
    expect(
      (await handler().h(await delivery(EVENT, { sub: "sub_x" }))).status
    ).toBe(410);
    expect((await handler("pending").h(await delivery(EVENT))).status).toBe(
      503
    );
    expect(
      (
        await handler().h(
          await delivery(EVENT, { ts: Math.floor(Date.now() / 1000) - 3600 })
        )
      ).status
    ).toBe(401);
  });

  it("returns 500 when onEvent throws, and dispatches the retry", async () => {
    const { h, log, setFail } = handler();
    setFail(true);
    expect((await h(await delivery(EVENT))).status).toBe(500);
    setFail(false);
    expect((await h(await delivery(EVENT))).status).toBe(200);
    expect(log).toEqual(["event:e1", "cursor:c1"]);
  });

  it("echoes exactly the challenge and handles gap and terminated", async () => {
    const { h, log } = handler();
    const v = await h(
      await delivery({ type: "verification", challenge: "abc" }, { id: "v1" })
    );
    expect(await v.json()).toEqual({ challenge: "abc" });
    await h(await delivery({ type: "gap", cursor: "c9" }, { id: "g1" }));
    await h(
      await delivery(
        { type: "terminated", error: { code: -32024, message: "x" } },
        { id: "t1" }
      )
    );
    expect(log).toEqual(["gap:c9", "cursor:c9", "terminated:-32024"]);
  });

  it("returns 413 for a body over 262,144 bytes", async () => {
    const big = { ...EVENT, data: "x".repeat(262_200) };
    expect((await handler().h(await delivery(big))).status).toBe(413);
  });
});

describe("verifyWebhookRequest", () => {
  it("returns the verified headers and parsed body", async () => {
    const r = await verifyWebhookRequest(await delivery(EVENT), [SECRET]);
    expect(r.webhookId).toBe("msg_1");
    expect(r.subscriptionId).toBe("sub_1");
    expect(r.body).toEqual(EVENT);
  });
});

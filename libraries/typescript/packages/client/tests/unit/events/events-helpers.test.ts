import { describe, expect, it } from "vitest";
import {
  createWebhookReceiver,
  generateWebhookSecret,
  listEvents,
  pollEvents,
  subscribeEvent,
  unsubscribeEvent,
} from "../../../src/events.js";

const DECLARES_EVENTS = {
  "io.modelcontextprotocol/clientCapabilities": {
    extensions: { "io.modelcontextprotocol/events": {} },
  },
};

describe("events helpers", () => {
  it("declare the official Events extension in every request's _meta", async () => {
    const sent: Array<[string, any]> = [];
    const session = {
      request: async (method: string, params: any) => {
        sent.push([method, params]);
        return {};
      },
    };
    await listEvents(session);
    await pollEvents(session, { name: "n" });
    await subscribeEvent(session, {
      name: "n",
      url: "https://cb.example/hook",
      secret: "whsec_AAAA",
    });
    await unsubscribeEvent(session, {
      name: "n",
      url: "https://cb.example/hook",
    });
    expect(sent.map(([m]) => m)).toEqual([
      "events/list",
      "events/poll",
      "events/subscribe",
      "events/unsubscribe",
    ]);
    for (const [, params] of sent)
      expect(params._meta).toEqual(DECLARES_EVENTS);
  });
});

async function signedRequest(secret: string, body: string, subId = "sub-1") {
  const id = "msg_1";
  const ts = String(Math.floor(Date.now() / 1000));
  const raw = Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${id}.${ts}.${body}`)
    )
  );
  const sig = btoa(String.fromCharCode(...mac));
  return new Request("https://cb.example/hook", {
    method: "POST",
    body,
    headers: {
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": `v1,${sig}`,
      "x-mcp-subscription-id": subId,
    },
  });
}

const EVENT = JSON.stringify({
  eventId: "e1",
  name: "n",
  timestamp: "2026-01-01T00:00:00Z",
  data: {},
});

describe("createWebhookReceiver", () => {
  it("does not ack a duplicate that arrives while the first delivery fails", async () => {
    const secret = generateWebhookSecret();
    let fail!: (e: Error) => void;
    let calls = 0;
    const receive = createWebhookReceiver({
      secrets: [secret],
      onEvent: () => {
        calls++;
        if (calls === 1)
          return new Promise<void>((_, reject) => (fail = reject));
      },
    });
    const first = receive(await signedRequest(secret, EVENT));
    // Send the duplicate once the first delivery's onEvent is running.
    while (calls === 0) await new Promise((r) => setTimeout(r, 1));
    let duplicateSettled = false;
    const duplicate = receive(await signedRequest(secret, EVENT));
    void duplicate.then(
      () => (duplicateSettled = true),
      () => (duplicateSettled = true)
    );
    // Give the duplicate time to verify its signature and reach dedupe.
    await new Promise((r) => setTimeout(r, 50));
    expect(duplicateSettled).toBe(false);
    fail(new Error("handler failed"));
    await expect(first).rejects.toThrow("handler failed");
    await expect(duplicate).rejects.toThrow("handler failed");

    // The retry after the failure runs onEvent again and is acked.
    const retry = await receive(await signedRequest(secret, EVENT));
    expect(retry.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("acks a duplicate of a delivery that succeeded without calling onEvent again", async () => {
    const secret = generateWebhookSecret();
    let calls = 0;
    const receive = createWebhookReceiver({
      secrets: [secret],
      onEvent: () => {
        calls++;
      },
    });
    expect((await receive(await signedRequest(secret, EVENT))).status).toBe(
      200
    );
    expect((await receive(await signedRequest(secret, EVENT))).status).toBe(
      200
    );
    expect(calls).toBe(1);
  });

  it("answers 401, not 500, when a configured secret is malformed", async () => {
    const good = generateWebhookSecret();
    const receive = createWebhookReceiver({
      secrets: ["whsec_not*base64!", good],
      onEvent: () => {},
    });
    const other = generateWebhookSecret();
    expect((await receive(await signedRequest(other, EVENT))).status).toBe(401);
    // The valid secret after the malformed one still verifies.
    expect((await receive(await signedRequest(good, EVENT))).status).toBe(200);
  });
});

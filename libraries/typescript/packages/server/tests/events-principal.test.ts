import type { AuthInfo } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { EventsRuntime } from "../src/events/runtime.js";

// Verification echoes the challenge; every other delivery is accepted.
const echo: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body)) as { challenge?: string };
  return new Response(JSON.stringify({ challenge: body.challenge }), {
    status: 200,
  });
};

const ctx = () => ({
  request: new Request("https://mcp.example.test/mcp", {
    method: "POST",
    headers: { "mcp-name": "note.created" },
  }),
  legacy: false,
  clientName: null,
});

// The shape mcp-use OAuth providers return: claims under extra.payload, and
// the same OAuth client for both users.
const user = (sub: string): AuthInfo => ({
  token: `token-${sub}`,
  clientId: "shared-client",
  scopes: [],
  extra: {
    payload: { iss: "https://idp.example.test/realms/mcp", sub },
    user: { id: sub },
  },
});

const subscribe = {
  name: "note.created",
  arguments: {},
  delivery: {
    mode: "webhook",
    url: "https://hooks.example.test/notes",
    secret: `whsec_${Buffer.alloc(32, 1).toString("base64")}`,
  },
};

describe("events subscription ownership with OAuth", () => {
  it("gives two users of the same OAuth client separate subscriptions", async () => {
    const runtime = new EventsRuntime(
      new Map([["note.created", { name: "note.created" }]]),
      { fetch: echo }
    );

    const alice = await runtime.handle(
      "events/subscribe",
      subscribe,
      user("alice"),
      ctx()
    );
    const bob = await runtime.handle(
      "events/subscribe",
      subscribe,
      user("bob"),
      ctx()
    );
    const aliceId = (alice.outcome as { result: { id: string } }).result.id;
    const bobId = (bob.outcome as { result: { id: string } }).result.id;
    expect(aliceId).not.toBe(bobId);

    // Bob unsubscribing removes only his subscription.
    await runtime.handle("events/unsubscribe", subscribe, user("bob"), ctx());
    const aliceUnsubscribe = await runtime.handle(
      "events/unsubscribe",
      subscribe,
      user("alice"),
      ctx()
    );
    expect(aliceUnsubscribe.outcome).toEqual({ result: {} });
  });
});

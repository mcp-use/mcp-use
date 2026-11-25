import { afterEach, describe, expect, it } from "vitest";
import { isPrivateAddress } from "../../src/net/address.js";
import { fetchWebhookSender } from "../../src/events/senders/fetch.js";
import { nodeWebhookSender } from "../../src/events/senders/node.js";
import {
  wireErrorCategory,
  type WebhookSender,
} from "../../src/events/senders/types.js";
import {
  createTestReceiver,
  type TestReceiver,
} from "../../src/events/testing/receiver.js";
import { createReceiverTlsFixture } from "./tls-fixture.js";

const tlsFixture = createReceiverTlsFixture();

const receivers: TestReceiver[] = [];
async function receiver(
  options: Parameters<typeof createTestReceiver>[0] = {}
): Promise<TestReceiver> {
  const created = await createTestReceiver(options);
  receivers.push(created);
  return created;
}
afterEach(async () => {
  await Promise.all(receivers.splice(0).map((r) => r.close()));
});

function send(
  sender: WebhookSender,
  url: string,
  trusted = false,
  body = '{"n":1}'
) {
  return sender({
    url,
    headers: { "content-type": "application/json", "webhook-id": "msg_1" },
    body,
    trusted,
    signal: new AbortController().signal,
  });
}

describe("isPrivateAddress (special-purpose ranges)", () => {
  it("refuses the ranges added for webhooks and keeps public ones", () => {
    for (const address of [
      "192.0.2.10",
      "198.51.100.7",
      "203.0.113.5",
      "192.88.99.1",
      "2002:c000:0204::1",
      "2001:0:4136:e378::1",
      "2001:db8::1",
      "::10.0.0.1",
      "::7f00:1",
      "::ffff:7f00:1",
      "64:ff9b::a00:1",
      "3fff::1",
      "not-an-ip",
      "300.1.1.1",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of [
      "93.184.215.14",
      "2606:4700::1111",
      "2001:4860:4860::8888",
    ]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

describe("nodeWebhookSender", () => {
  it("POSTs body and headers to a trusted origin and returns status and body", async () => {
    const inbox = await receiver({ statuses: [202], echo: "body" });
    const result = await send(
      nodeWebhookSender(),
      `${inbox.url}hook?a=1`,
      true
    );
    expect(result).toEqual({ status: 202, body: '{"n":1}' });
    expect(inbox.requests).toHaveLength(1);
    expect(inbox.requests[0]).toMatchObject({
      method: "POST",
      path: "/hook?a=1",
      body: '{"n":1}',
      headers: {
        "content-type": "application/json",
        "webhook-id": "msg_1",
        host: `127.0.0.1:${inbox.port}`,
      },
    });
  });

  it("reads at most 4 KiB of the response body", async () => {
    const inbox = await receiver({ echo: "body" });
    const result = await send(
      nodeWebhookSender(),
      inbox.url,
      true,
      "x".repeat(10_000)
    );
    expect(result).toEqual({ status: 200, body: "x".repeat(4096) });
  });

  it("reports Retry-After in milliseconds", async () => {
    const inbox = await receiver({
      statuses: [503],
      headers: { "retry-after": "7" },
    });
    expect(await send(nodeWebhookSender(), inbox.url, true)).toEqual({
      status: 503,
      body: "",
      retryAfterMs: 7000,
    });
  });

  it("does not follow a 307, which is connection_refused on the wire", async () => {
    const other = await receiver();
    const inbox = await receiver({ redirectTo: other.url });
    expect(await send(nodeWebhookSender(), inbox.url, true)).toEqual({
      error: "redirect",
    });
    expect(wireErrorCategory("redirect")).toBe("connection_refused");
    expect(inbox.requests).toHaveLength(1);
    expect(other.requests).toHaveLength(0);
  });

  it("refuses hosts whose DNS answers include a special-purpose address", async () => {
    const asked: string[] = [];
    const sender = nodeWebhookSender({
      resolve: async (host) => {
        asked.push(host);
        return host === "mixed.example"
          ? ["93.184.215.14", "10.0.0.1"]
          : ["169.254.169.254"];
      },
    });
    expect(await send(sender, "https://metadata.example/")).toEqual({
      error: "blocked_address",
    });
    expect(await send(sender, "https://mixed.example/")).toEqual({
      error: "blocked_address",
    });
    expect(asked).toEqual(["metadata.example", "mixed.example"]);
    expect(wireErrorCategory("blocked_address")).toBe("connection_refused");
  });

  it("refuses private IP literals, localhost, http and credentials without resolving", async () => {
    const asked: string[] = [];
    const sender = nodeWebhookSender({
      resolve: async (host) => {
        asked.push(host);
        return ["93.184.215.14"];
      },
    });
    for (const url of [
      "https://10.0.0.1/",
      "https://[::1]/",
      "https://localhost/",
      "http://public.example/",
      "https://user:pw@public.example/",
    ]) {
      expect(await send(sender, url), url).toEqual({
        error: "blocked_address",
      });
    }
    expect(asked).toEqual([]);
  });

  it("maps resolution failures and empty answers to dns_failure", async () => {
    const failing = nodeWebhookSender({
      resolve: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    const empty = nodeWebhookSender({ resolve: async () => [] });
    expect(await send(failing, "https://gone.example/")).toEqual({
      error: "dns_failure",
    });
    expect(await send(empty, "https://gone.example/")).toEqual({
      error: "dns_failure",
    });
    expect(wireErrorCategory("dns_failure")).toBe("connection_refused");
  });

  it("times out a slow receiver", async () => {
    const inbox = await receiver({ delayMs: 1_000 });
    const sender = nodeWebhookSender({ totalTimeoutMs: 150 });
    expect(await send(sender, inbox.url, true)).toEqual({ error: "timeout" });
  });

  it("reports a closed port as connection_refused", async () => {
    const inbox = await receiver();
    await inbox.close();
    receivers.pop();
    expect(await send(nodeWebhookSender(), inbox.url, true)).toEqual({
      error: "connection_refused",
    });
  });

  it("reports an untrusted certificate as tls_error", async () => {
    const inbox = await receiver({ tls: tlsFixture });
    expect(await send(nodeWebhookSender(), inbox.url, true)).toEqual({
      error: "tls_error",
    });
    expect(inbox.requests).toHaveLength(0);
  });

  it("rejects an invalid proxy URL at startup", () => {
    expect(() => nodeWebhookSender({ proxy: "socks5://p:1080" })).toThrow(
      expect.objectContaining({
        code: "EVENTS_CONFIG_INVALID",
        data: { field: "egressProxy" },
      })
    );
  });
});

describe("fetchWebhookSender", () => {
  it("refuses URLs it cannot check before any request", async () => {
    const fetched: string[] = [];
    const sender = fetchWebhookSender({
      fetch: async (input) => {
        fetched.push(String(input));
        return new Response("");
      },
      resolve: async (host) =>
        host === "private.example" ? ["10.0.0.1"] : ["93.184.215.14"],
    });
    for (const url of [
      "http://public.example/",
      "https://93.184.215.14/",
      "https://inbox/",
      "https://printer.local/",
      "https://svc.internal/",
      "https://localhost/",
      "https://u:p@public.example/",
      "https://private.example/",
    ]) {
      expect(await send(sender, url), url).toEqual({
        error: "blocked_address",
      });
    }
    expect(fetched).toEqual([]);
  });

  it("POSTs to a public host after the DoH pre-check", async () => {
    const fetched: { url: string; method: unknown; body: unknown }[] = [];
    const sender = fetchWebhookSender({
      fetch: async (input, init) => {
        fetched.push({
          url: String(input),
          method: init?.method,
          body: init?.body,
        });
        return new Response("ok", {
          status: 429,
          headers: { "retry-after": "3" },
        });
      },
      resolve: async () => ["93.184.215.14"],
    });
    expect(await send(sender, "https://hooks.example/in")).toEqual({
      status: 429,
      body: "ok",
      retryAfterMs: 3000,
    });
    expect(fetched).toEqual([
      { url: "https://hooks.example/in", method: "POST", body: '{"n":1}' },
    ]);
  });

  it("POSTs to a trusted origin and does not follow a 307", async () => {
    const other = await receiver();
    const redirecting = await receiver({ redirectTo: other.url });
    const echoing = await receiver({ statuses: [201], echo: "body" });
    const sender = fetchWebhookSender();
    expect(await send(sender, echoing.url, true)).toEqual({
      status: 201,
      body: '{"n":1}',
    });
    expect(await send(sender, redirecting.url, true)).toEqual({
      error: "redirect",
    });
    expect(other.requests).toHaveLength(0);
  });
});

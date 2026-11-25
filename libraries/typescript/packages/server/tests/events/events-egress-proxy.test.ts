import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { fetchWebhookSender } from "../../src/events/senders/fetch.js";
import { nodeWebhookSender } from "../../src/events/senders/node.js";
import {
  wireErrorCategory,
  type WebhookSendResponse,
  type WebhookSendError,
} from "../../src/events/senders/types.js";
import {
  createTestEgressProxy,
  type TestEgressProxy,
} from "../../src/events/testing/egress-proxy.js";
import {
  createTestReceiver,
  type TestReceiver,
} from "../../src/events/testing/receiver.js";

const fixtures = new URL("./fixtures/", import.meta.url);
const cert = readFileSync(new URL("receiver-cert.pem", fixtures), "utf8");
const key = readFileSync(new URL("receiver-key.pem", fixtures), "utf8");

const running: (TestReceiver | TestEgressProxy)[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.close()));
});

/** An HTTPS receiver for `receiver.test` and a proxy that routes to it. */
async function setup(
  proxyOptions: Parameters<typeof createTestEgressProxy>[0] = {}
) {
  const inbox = await createTestReceiver({
    tls: { cert, key },
    statuses: [200],
    echo: "body",
  });
  const proxy = await createTestEgressProxy({
    route: () => ({ host: "127.0.0.1", port: inbox.port }),
    ...proxyOptions,
  });
  running.push(inbox, proxy);
  return { inbox, proxy };
}

function post(
  sender: ReturnType<typeof nodeWebhookSender>,
  url: string,
  trusted = false
): Promise<WebhookSendResponse | WebhookSendError> {
  return sender({
    url,
    headers: { "content-type": "application/json" },
    body: '{"e":1}',
    trusted,
    signal: new AbortController().signal,
  });
}

describe("events egress proxy (D65)", () => {
  it("CONNECTs to the validated IP with Proxy-Authorization; SNI and Host are the hostname", async () => {
    const { inbox, proxy } = await setup({ credentials: "ns-1:s3cret" });
    const sender = nodeWebhookSender({
      proxy: proxy.url,
      resolve: async () => ["93.184.215.14"],
      tls: { ca: cert },
    });
    const result = await post(sender, "https://receiver.test:8443/hook");
    expect(result).toEqual({ status: 200, body: '{"e":1}' });
    expect(proxy.connects).toEqual([
      {
        target: "93.184.215.14:8443",
        authorization: `Basic ${btoa("ns-1:s3cret")}`,
        status: 200,
        servername: "receiver.test",
      },
    ]);
    expect(inbox.requests).toHaveLength(1);
    expect(inbox.requests[0]).toMatchObject({
      method: "POST",
      path: "/hook",
      servername: "receiver.test",
      headers: { host: "receiver.test:8443" },
    });
  });

  it("brackets an IPv6 validated address in the CONNECT authority", async () => {
    const { proxy } = await setup();
    const sender = nodeWebhookSender({
      proxy: proxy.url,
      resolve: async () => ["2606:4700::1111"],
      tls: { ca: cert },
    });
    expect(await post(sender, "https://receiver.test/")).toEqual({
      status: 200,
      body: '{"e":1}',
    });
    expect(proxy.connects.map((c) => c.target)).toEqual([
      "[2606:4700::1111]:443",
    ]);
  });

  it("refuses a private resolution before any CONNECT", async () => {
    const { inbox, proxy } = await setup();
    const sender = nodeWebhookSender({
      proxy: proxy.url,
      resolve: async () => ["10.0.0.1"],
      tls: { ca: cert },
    });
    expect(await post(sender, "https://receiver.test/")).toEqual({
      error: "blocked_address",
    });
    expect(proxy.connects).toEqual([]);
    expect(inbox.requests).toEqual([]);
  });

  it("maps a proxy 403 to connection_refused on the wire", async () => {
    const { inbox, proxy } = await setup({ refuse: () => 403 });
    const sender = nodeWebhookSender({
      proxy: proxy.url,
      resolve: async () => ["93.184.215.14"],
      tls: { ca: cert },
    });
    const result = await post(sender, "https://receiver.test/");
    expect(result).toEqual({ error: "blocked_address" });
    expect(wireErrorCategory((result as WebhookSendError).error)).toBe(
      "connection_refused"
    );
    expect(proxy.connects).toEqual([
      { target: "93.184.215.14:443", status: 403 },
    ]);
    expect(inbox.requests).toEqual([]);
  });

  it("maps a proxy 502 to connection_refused", async () => {
    const { proxy } = await setup({ refuse: () => 502 });
    const sender = nodeWebhookSender({
      proxy: proxy.url,
      resolve: async () => ["93.184.215.14"],
    });
    expect(await post(sender, "https://receiver.test/")).toEqual({
      error: "connection_refused",
    });
  });

  it("lets a trusted dev inbox bypass the proxy", async () => {
    const { proxy } = await setup();
    const devInbox = await createTestReceiver({ statuses: [204] });
    running.push(devInbox);
    const sender = nodeWebhookSender({
      proxy: proxy.url,
      resolve: async () => ["93.184.215.14"],
    });
    expect(await post(sender, devInbox.url, true)).toEqual({
      status: 204,
      body: "",
    });
    expect(devInbox.requests).toHaveLength(1);
    expect(proxy.connects).toEqual([]);
  });

  it("fails startup when a proxy is configured on the fetch sender", () => {
    expect(() =>
      fetchWebhookSender({ proxy: "http://u:p@egress.example:3128" })
    ).toThrow(
      expect.objectContaining({
        code: "EVENTS_CONFIG_INVALID",
        data: { field: "egressProxy" },
      })
    );
  });
});

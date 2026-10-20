import { createHash } from "node:crypto";

import { AnalyticsClient, type PendingEvent } from "../src/client.js";
import {
  Instrumentation,
  NO_HEADERS,
  type RequestFacts,
} from "../src/record.js";
import type { AnalyticsOptions, RemoteConfig } from "../src/types.js";
import { edgeRejection } from "./helpers/edge.js";
import { startIngest } from "./helpers/ingest.js";
import { resetAnalytics } from "./helpers/state.js";

const OFF: RemoteConfig = { capture_payloads: false, identify_actors: false };
const ON: RemoteConfig = { capture_payloads: true, identify_actors: true };

function harness(hooks: Instrumentation["hooks"] = {}) {
  const client = new AnalyticsClient({
    apiKey: "mfi_unit",
    endpoint: "https://ingest.test",
    debug: false,
    flushIntervalMs: 1000,
    maxBatchSize: 100,
    maxQueueSize: 1000,
  });
  const queued: PendingEvent[] = [];
  vi.spyOn(client, "enqueue").mockImplementation((event) => {
    queued.push(event);
  });
  const inst = new Instrumentation(client, { framework: "mcp-sdk-v1" }, hooks);
  return { client, inst, queued };
}

function headers(values: Record<string, string>): RequestFacts["header"] {
  const lower = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k.toLowerCase(), v])
  );
  return (name) => lower[name.toLowerCase()];
}

function facts(overrides: Partial<RequestFacts> = {}): RequestFacts {
  return {
    method: "tools/call",
    requestId: 7,
    params: { name: "get_balance", arguments: { account: "a1" } },
    header: NO_HEADERS,
    raw: undefined,
    ...overrides,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await resetAnalytics();
});

describe("wire event", () => {
  it("maps request facts to the manufact.sdk.v1 fields", async () => {
    const { inst, queued } = harness();
    const record = inst.begin(
      facts({
        sessionId: "sess-1",
        url: "https://app.example.com/api/mcp",
        httpMethod: "POST",
        transport: "streamable-http",
        stateless: false,
        protocolVersion: "2025-06-18",
        client: { name: "claude-ai", version: "0.1.0" },
        meta: {
          traceparent:
            "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          "openai/session": "conv-1",
          "openai/subject": "subj-1",
          "openai/organization": "org-1",
          "openai/userLocation": { country: "us" },
        },
        header: headers({
          Host: "app.example.com",
          "User-Agent": "openai-mcp/1.0.0",
          Origin: "https://chatgpt.com",
          Referer: "https://chatgpt.com/c/1",
          "CF-IPCountry": "BR",
        }),
      }),
      [{}]
    );
    record!.succeed({ content: [{ type: "text", text: "42" }] });
    expect(queued).toHaveLength(1);
    const event = await queued[0]!.toWire(OFF);
    expect(event).toMatchObject({
      method: "tools/call",
      request_id: 7,
      target: "get_balance",
      outcome: "success",
      session_id: "sess-1",
      client: { name: "claude-ai", version: "0.1.0" },
      protocol_version: "2025-06-18",
      transport: "streamable-http",
      stateless: false,
      http: {
        method: "POST",
        path: "/api/mcp",
        host: "app.example.com",
        user_agent: "openai-mcp/1.0.0",
        origin: "https://chatgpt.com",
        referer: "https://chatgpt.com/c/1",
        country: "BR",
      },
      openai: {
        session: "conv-1",
        subject: "subj-1",
        organization: "org-1",
        country: "US",
      },
      trace_id: "0af7651916cd43dd8448eb211c80319c",
    });
    expect(event?.duration_ms).toBeGreaterThanOrEqual(0);
    expect(event?.request_size).toBe(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "get_balance", arguments: { account: "a1" } },
      }).length
    );
    expect(event?.response_size).toBeGreaterThan(0);
    expect(event?.request_payload).toBeUndefined();
    expect(event?.actor).toBeUndefined();
    expect(event?.error).toBeUndefined();
  });

  it("joins the text content of an isError tool result, cut to 500 characters", async () => {
    const { inst, queued } = harness();
    inst.begin(facts(), [{}])!.succeed({
      isError: true,
      content: [
        { type: "text", text: "first" },
        { type: "image", data: "x", mimeType: "image/png" },
        { type: "text", text: "second" },
      ],
    });
    inst.begin(facts(), [{}])!.succeed({
      isError: true,
      content: [{ type: "text", text: "y".repeat(600) }],
    });
    const [joined, long] = await Promise.all(queued.map((e) => e.toWire(OFF)));
    expect(joined).toMatchObject({
      outcome: "tool_error",
      error: { message: "first\nsecond" },
    });
    expect(long?.error?.message).toHaveLength(500);
  });

  it("records thrown errors and JSON-RPC error responses with code and message", async () => {
    const { inst, queued } = harness();
    inst
      .begin(facts(), [{}])!
      .fail(Object.assign(new Error("Unknown tool"), { code: -32602 }));
    inst.begin(facts(), [{}])!.fail(new Error("z".repeat(900)));
    inst.begin(facts(), [{}])!.fail("plain string");
    inst
      .begin(facts(), [{}])!
      .respond({ error: { code: -32601, message: "Method not found" } });
    const [coded, long, plain, rpc] = await Promise.all(
      queued.map((e) => e.toWire(OFF))
    );
    expect(coded).toMatchObject({
      outcome: "error",
      error: { code: -32602, message: "Unknown tool" },
    });
    expect(long?.error?.code).toBe(-32603);
    expect(long?.error?.message).toHaveLength(500);
    expect(plain?.error).toEqual({ code: -32603, message: "plain string" });
    expect(rpc).toMatchObject({
      outcome: "error",
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("sends an abandoned request without an outcome", async () => {
    const { inst, queued } = harness();
    inst.begin(facts(), [{}])!.abandon();
    const event = await queued[0]!.toWire(OFF);
    expect(event?.outcome).toBeUndefined();
    expect(event?.method).toBe("tools/call");
  });

  it("sends an abandoned request without a response, keeps its actor and conversation, and ignores a later result", async () => {
    const claims = { iss: "https://idp.example", sub: "u-1" };
    const jwt = `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
    const seen: unknown[] = [];
    const { inst, queued } = harness({
      conversationId: (ctx) => {
        seen.push(ctx);
        return "conv-9";
      },
    });
    const record = inst.begin(
      facts({ header: headers({ Authorization: `Bearer ${jwt}` }) }),
      [{}]
    )!;
    record.abandon();
    expect(record.finished).toBe(true);
    record.succeed({ content: [{ type: "text", text: "late" }] });
    record.fail(new Error("late"));
    expect(queued).toHaveLength(1);
    const event = await queued[0]!.toWire(ON);
    expect(event?.outcome).toBeUndefined();
    expect(event?.error).toBeUndefined();
    expect(event?.response_size).toBeUndefined();
    expect(event?.response_payload).toBeUndefined();
    expect(event?.request_payload).toMatchObject({ method: "tools/call" });
    expect(event?.conversation_id).toBe("conv-9");
    expect(event?.actor?.token_hash).toBe(
      createHash("sha256").update("https://idp.example\0u-1").digest("hex")
    );
    expect(seen[0]).not.toHaveProperty("result");
    expect(seen[0]).not.toHaveProperty("error");
    expect(edgeRejection(event)).toBeUndefined();
  });

  it("records a request once", () => {
    const { inst, queued } = harness();
    const message = {};
    const record = inst.begin(facts(), [message]);
    expect(inst.begin(facts(), [message])).toBeUndefined();
    record!.succeed({});
    record!.succeed({});
    expect(queued).toHaveLength(1);
  });

  it("skips requests the gateway already recorded", () => {
    const { inst } = harness();
    expect(
      inst.begin(
        facts({ header: headers({ "X-Gateway-Request-Id": "req_1" }) }),
        [{}]
      )
    ).toBeUndefined();
  });

  it("records nothing while the client is inactive", () => {
    const { inst, client } = harness();
    vi.spyOn(client, "active", "get").mockReturnValue(false);
    expect(inst.begin(facts(), [{}])).toBeUndefined();
  });

  it("sends a bounded, redacted client_info on initialize", async () => {
    const { inst, queued } = harness();
    inst
      .begin(
        facts({
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            clientInfo: { name: "cursor", version: "1.0", token: "leak" },
          },
        }),
        [{}]
      )!
      .succeed({
        protocolVersion: "2025-06-18",
        serverInfo: { name: "srv", version: "9" },
      });
    const event = await queued[0]!.toWire(OFF);
    expect(event?.client_info).toEqual({
      name: "cursor",
      version: "1.0",
      token: "[REDACTED]",
    });
    expect(event?.target).toBeUndefined();
  });
});

describe("payload capture", () => {
  async function capture(
    config: RemoteConfig,
    hooks: Instrumentation["hooks"] = {}
  ) {
    const { inst, queued } = harness(hooks);
    inst
      .begin(
        facts({
          params: {
            name: "login",
            arguments: { user: "ada", password: "hunter2" },
          },
        }),
        [{}]
      )!
      .succeed({ content: [{ type: "text", text: "ok" }] });
    return queued[0]!.toWire(config);
  }

  it("sends redacted JSON-RPC request and response when the dashboard allows it", async () => {
    const event = await capture(ON);
    expect(event?.request_payload).toEqual({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "login",
        arguments: { user: "ada", password: "[REDACTED]" },
      },
    });
    expect(event?.response_payload).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { content: [{ type: "text", text: "ok" }] },
    });
  });

  it("never sends payloads when capture is off remotely or disabled locally", async () => {
    expect((await capture(OFF))?.request_payload).toBeUndefined();
    const local = await capture(ON, { capturePayloads: false });
    expect(local?.request_payload).toBeUndefined();
    expect(local?.response_payload).toBeUndefined();
  });

  it("runs the user's redact hook last, which can edit or drop events", async () => {
    const edited = await capture(ON, {
      redact: (event) => ({
        ...event,
        target: "[hidden]",
        request_payload: undefined,
      }),
    });
    expect(edited?.target).toBe("[hidden]");
    expect(edited?.request_payload).toBeUndefined();
    expect(await capture(ON, { redact: () => null })).toBeNull();
    expect(
      await capture(ON, {
        redact: () => {
          throw new Error("bug");
        },
      })
    ).toBeNull();
    const kept = await capture(OFF, { redact: () => undefined });
    expect(kept?.target).toBe("login");
  });
});

/** A Bearer token with display claims, and its `actor.token_hash`. */
const claims = {
  iss: "https://idp.example",
  sub: "u-1",
  name: "Ada",
  email: "ada@example.com",
};
const jwt = `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const tokenHash = createHash("sha256")
  .update("https://idp.example\0u-1")
  .digest("hex");

describe("actor", () => {
  async function actor(
    config: RemoteConfig,
    hooks: Instrumentation["hooks"] = {},
    auth = `Bearer ${jwt}`
  ) {
    const { inst, queued } = harness(hooks);
    inst
      .begin(facts({ header: headers({ Authorization: auth }) }), [{}])!
      .succeed({});
    return (await queued[0]!.toWire(config))?.actor;
  }

  it("sends the token hash, and names only when identify_actors is on", async () => {
    expect(await actor(OFF)).toEqual({ token_hash: tokenHash });
    expect(await actor(ON)).toEqual({
      token_hash: tokenHash,
      name: "Ada",
      email: "ada@example.com",
    });
  });

  it("keeps the token's name and email for serialization when identify_actors was off as it was recorded", async () => {
    // The client knows "identify actors" is off when the request completes...
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ config: OFF }))
    );
    const { client, inst, queued } = harness();
    vi.mocked(client.enqueue).mockRestore();
    client.enqueue({
      source: { framework: "mcp-sdk-v1" },
      toWire: async () => null,
    });
    await client.flush();
    expect(client.remoteConfig).toEqual(OFF);
    vi.spyOn(client, "enqueue").mockImplementation((event) => {
      queued.push(event);
    });
    inst
      .begin(facts({ header: headers({ Authorization: `Bearer ${jwt}` }) }), [
        {},
      ])!
      .succeed({});
    // ...and on by the time the event is serialized.
    expect((await queued[0]!.toWire(ON))?.actor).toEqual({
      token_hash: tokenHash,
      name: "Ada",
      email: "ada@example.com",
    });
    expect((await queued[0]!.toWire(OFF))?.actor).toEqual({
      token_hash: tokenHash,
    });
  });

  it("uses the verified authInfo token when there is no Authorization header", async () => {
    const { inst, queued } = harness();
    inst
      .begin(facts({ authInfo: { token: "opaque-1", clientId: "c" } }), [{}])!
      .succeed({});
    expect((await queued[0]!.toWire(OFF))?.actor?.token_hash).toBe(
      createHash("sha256").update("opaque-1").digest("hex")
    );
  });

  it("lets identify() override or remove the actor", async () => {
    const identify: AnalyticsOptions["identify"] = (ctx) => {
      expect(ctx.method).toBe("tools/call");
      expect(ctx.header("authorization")).toBe(`Bearer ${jwt}`);
      expect(ctx.result).toEqual({});
      return { id: "customer-9", name: "Grace" };
    };
    expect(await actor(ON, { identify })).toEqual({
      token_hash: createHash("sha256").update("customer-9").digest("hex"),
      name: "Grace",
      email: "ada@example.com",
    });
    expect(await actor(ON, { identify: () => null })).toBeUndefined();
    expect(await actor(OFF, { identify: async () => undefined })).toEqual({
      token_hash: tokenHash,
    });
    // Async hooks can still read headers after the record released them.
    expect(
      await actor(OFF, {
        identify: async (ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { id: ctx.header("Authorization") ?? "missing" };
        },
      })
    ).toEqual({
      token_hash: createHash("sha256").update(`Bearer ${jwt}`).digest("hex"),
    });
    expect(
      await actor(OFF, {
        identify: () => {
          throw new Error("bug");
        },
      })
    ).toEqual({ token_hash: tokenHash });
  });

  it("never sends Manufact API keys", async () => {
    expect(await actor(ON, {}, "Bearer mcp_secret")).toBeUndefined();
  });

  it("sends no actor for a name or email without an id or a Bearer token", async () => {
    // The edge keeps names only next to a token_hash, as the Python SDK does.
    const identify = () => ({ name: "Grace", email: "grace@example.com" });
    const { inst, queued } = harness({ identify });
    inst.begin(facts(), [{}])!.succeed({});
    expect((await queued[0]!.toWire(ON))?.actor).toBeUndefined();
    // An API key is no actor either, so the names are not sent with it.
    expect(await actor(ON, { identify }, "Bearer mcp_secret")).toBeUndefined();
    // With an id, or a token to hash, the same names are sent.
    expect(
      await actor(ON, { identify: () => ({ ...identify(), id: "u-9" }) }, "")
    ).toEqual({
      token_hash: createHash("sha256").update("u-9").digest("hex"),
      name: "Grace",
      email: "grace@example.com",
    });
    expect(await actor(ON, { identify })).toEqual({
      token_hash: tokenHash,
      name: "Grace",
      email: "grace@example.com",
    });
  });
});

describe("dashboard settings", () => {
  it("applies capture and identify, turned on then off, to the first batch recorded a minute later", async () => {
    const ingest = await startIngest({ ...OFF });
    const client = new AnalyticsClient({
      apiKey: "mfi_unit",
      endpoint: ingest.url,
      debug: false,
      flushIntervalMs: 60_000,
      maxBatchSize: 100,
      maxQueueSize: 1000,
    });
    let now = 1_000;
    client.clock = () => now;
    const inst = new Instrumentation(client, { framework: "mcp-sdk-v1" }, {});
    const record = async () => {
      const sent = ingest.events().length;
      inst
        .begin(
          facts({
            params: { name: "search", arguments: { query: "q" } },
            header: headers({ Authorization: `Bearer ${jwt}` }),
          }),
          [{}]
        )!
        .succeed({ content: [{ type: "text", text: "ok" }] });
      await client.flush();
      const events = ingest.events().slice(sent);
      expect(events).toHaveLength(1);
      return events[0]!;
    };

    try {
      const before = await record();
      expect(before.request_payload).toBeUndefined();
      expect(before.response_payload).toBeUndefined();
      expect(before.actor).toEqual({ token_hash: tokenHash });

      ingest.config = { ...ON };
      now += 61_000;
      const on = await record();
      expect(on.request_payload).toMatchObject({
        method: "tools/call",
        params: { name: "search", arguments: { query: "q" } },
      });
      expect(on.response_payload).toMatchObject({
        result: { content: [{ type: "text", text: "ok" }] },
      });
      expect(on.actor).toEqual({
        token_hash: tokenHash,
        name: "Ada",
        email: "ada@example.com",
      });

      ingest.config = { ...OFF };
      now += 61_000;
      const off = await record();
      expect(off.request_payload).toBeUndefined();
      expect(off.response_payload).toBeUndefined();
      expect(off.actor).toEqual({ token_hash: tokenHash });
      expect(ingest.requests.filter((r) => r.method === "GET")).toHaveLength(3);
    } finally {
      await client.shutdown();
      await ingest.close();
    }
  });
});

describe("conversation id", () => {
  it("sends the value returned by conversationId()", async () => {
    const { inst, queued } = harness({
      conversationId: (ctx) => `conv-${String(ctx.requestId)}`,
    });
    inst.begin(facts(), [{}])!.succeed({});
    expect((await queued[0]!.toWire(OFF))?.conversation_id).toBe("conv-7");
  });

  it("ignores empty values and errors", async () => {
    const { inst, queued } = harness({
      conversationId: () => {
        throw new Error("bug");
      },
    });
    inst.begin(facts(), [{}])!.succeed({});
    expect((await queued[0]!.toWire(OFF))?.conversation_id).toBeUndefined();
  });
});

describe("ingest edge limits", () => {
  it("clips every field to the edge's limits so it never rejects the event", async () => {
    const { inst, queued } = harness();
    // Ends on the high half of a surrogate pair at the cut, which must not
    // leave a lone surrogate behind.
    const longName = `${"n".repeat(255)}\u{1F600}${"n".repeat(50)}`;
    inst
      .begin(
        facts({
          method: "resources/read",
          params: { uri: `file:///${"u".repeat(5000)}` },
          sessionId: "s".repeat(600),
          protocolVersion: "2".repeat(100),
          client: { name: longName, version: "v".repeat(300) },
          url: `https://app.example.com/${"p".repeat(3000)}`,
          httpMethod: "P".repeat(20),
          meta: {
            traceparent: `00-${"a".repeat(70)}-b7ad6b7169203331-01`,
            "openai/subject": "j".repeat(600),
            "openai/organization": "o".repeat(600),
          },
          header: headers({
            Host: `${"h".repeat(300)}.example.com`,
            "User-Agent": "a".repeat(5000),
            Origin: `https://${"o".repeat(3000)}`,
            Referer: `https://chatgpt.com/${"r".repeat(5000)}`,
            "X-OpenAI-Session": "x".repeat(600),
          }),
        }),
        [{}]
      )!
      .succeed({ contents: [] });
    const event = await queued[0]!.toWire(OFF);
    expect(edgeRejection(event)).toBeUndefined();
    expect(event?.target).toHaveLength(4096);
    expect(event?.session_id).toHaveLength(512);
    expect(event?.protocol_version).toHaveLength(64);
    expect(event?.client?.name).toBe("n".repeat(255));
    expect(event?.client?.version).toHaveLength(256);
    expect(event?.http?.method).toHaveLength(16);
    expect(event?.http?.path).toHaveLength(2048);
    expect(event?.http?.host).toHaveLength(260);
    expect(event?.http?.user_agent).toHaveLength(4096);
    expect(event?.http?.origin).toHaveLength(2048);
    expect(event?.http?.referer).toHaveLength(4096);
    expect(event?.openai).toEqual({
      session: "x".repeat(512),
      subject: "j".repeat(512),
      organization: "o".repeat(512),
    });
    // 70 hex characters is not a trace id.
    expect(event?.trace_id).toBeUndefined();
  });

  it("cuts by UTF-16 code units and never splits an emoji at any limit", async () => {
    // Each value puts an emoji (two UTF-16 code units) across its field's
    // limit: the edge counts code units, so it must be cut before the emoji.
    // (The path is left out: URL parsing percent-encodes it to ASCII.)
    const at = (limit: number, prefix = "") =>
      `${prefix}${"x".repeat(limit - 1 - prefix.length)}\u{1F600}tail`;
    const { inst, queued } = harness({ conversationId: () => at(512) });
    inst
      .begin(
        facts({
          requestId: at(200),
          params: { name: at(4096) },
          sessionId: at(512),
          protocolVersion: at(64),
          client: { name: at(256), version: at(256) },
          url: "https://app.example.com/mcp",
          httpMethod: at(16),
          meta: {
            "openai/session": at(512),
            "openai/subject": at(512),
            "openai/organization": at(512),
          },
          header: headers({
            Host: at(260),
            "User-Agent": at(4096),
            Origin: at(2048),
            Referer: at(4096),
          }),
        }),
        [{}]
      )!
      .fail(new Error(at(500)));
    inst.begin(facts({ method: at(200, "x/") }), [{}])!.succeed({});
    const event = await queued[0]!.toWire(OFF);
    const other = await queued[1]!.toWire(OFF);
    expect(edgeRejection(event)).toBeUndefined();
    expect(edgeRejection(other)).toBeUndefined();
    const values = [
      [other?.method, 200],
      [event?.request_id, 200],
      [event?.target, 4096],
      [event?.session_id, 512],
      [event?.conversation_id, 512],
      [event?.protocol_version, 64],
      [event?.client?.name, 256],
      [event?.client?.version, 256],
      [event?.http?.method, 16],
      [event?.http?.host, 260],
      [event?.http?.user_agent, 4096],
      [event?.http?.origin, 2048],
      [event?.http?.referer, 4096],
      [event?.openai?.session, 512],
      [event?.openai?.subject, 512],
      [event?.openai?.organization, 512],
      [event?.error?.message, 500],
    ] as const;
    for (const [value, limit] of values) {
      expect(value).toHaveLength(limit - 1);
      expect(String(value)).toMatch(/x$/);
    }
  });

  it("clips conversation ids and long JSON-RPC methods", async () => {
    const { inst, queued } = harness({ conversationId: () => "c".repeat(600) });
    inst.begin(facts({ method: `x/${"m".repeat(300)}` }), [{}])!.succeed({});
    const event = await queued[0]!.toWire(OFF);
    expect(edgeRejection(event)).toBeUndefined();
    expect(event?.conversation_id).toHaveLength(512);
    expect(event?.method).toHaveLength(200);
  });

  it("leaves out an error code outside int32 and keeps the rest of the event", async () => {
    const { inst, queued } = harness();
    inst
      .begin(facts(), [{}])!
      .respond({ error: { code: 0x80070005, message: "Access denied" } });
    inst.begin(facts(), [{}])!.respond({ error: { code: 1.5, message: "x" } });
    inst
      .begin(facts(), [{}])!
      .respond({ error: { code: -32000, message: "y" } });
    const [hresult, fraction, server] = await Promise.all(
      queued.map((e) => e.toWire(OFF))
    );
    expect(hresult?.error).toEqual({ message: "Access denied" });
    expect(hresult?.outcome).toBe("error");
    expect(edgeRejection(hresult)).toBeUndefined();
    expect(fraction?.error).toEqual({ message: "x" });
    expect(server?.error).toEqual({ code: -32000, message: "y" });
  });

  it("lowercases the trace id and falls back to the header when _meta has none", async () => {
    const { inst, queued } = harness();
    inst
      .begin(
        facts({
          meta: { traceparent: "00-xyz-01" },
          header: headers({
            traceparent:
              "00-0AF7651916CD43DD8448EB211C80319C-b7ad6b7169203331-01",
          }),
        }),
        [{}]
      )!
      .succeed({});
    expect((await queued[0]!.toWire(OFF))?.trace_id).toBe(
      "0af7651916cd43dd8448eb211c80319c"
    );
  });

  it("sends only an object as client_info", async () => {
    const { inst, queued } = harness();
    inst
      .begin(
        facts({
          method: "initialize",
          params: { protocolVersion: "2025-06-18", clientInfo: "cursor" },
        }),
        [{}]
      )!
      .succeed({});
    const event = await queued[0]!.toWire(OFF);
    expect(event?.client_info).toBeUndefined();
    expect(edgeRejection(event)).toBeUndefined();
  });
});

describe("forwarded headers", () => {
  it("takes the first entry of a multi-value X-Forwarded-Host", async () => {
    const { inst, queued } = harness();
    inst
      .begin(
        facts({
          url: "http://10.0.0.5:3000/mcp",
          header: headers({
            Host: "10.0.0.5:3000",
            // SDK v1 joins repeated headers with ", ".
            "X-Forwarded-Host": " app.example.com , internal.lb",
          }),
        }),
        [{}]
      )!
      .succeed({});
    expect((await queued[0]!.toWire(OFF))?.http?.host).toBe("app.example.com");
  });

  it("falls back to Host when X-Forwarded-Host is empty", async () => {
    const { inst, queued } = harness();
    inst
      .begin(
        facts({
          header: headers({ Host: "app.example.com", "X-Forwarded-Host": "" }),
        }),
        [{}]
      )!
      .succeed({});
    expect((await queued[0]!.toWire(OFF))?.http?.host).toBe("app.example.com");
  });

  it("reads the country from the first platform header with a real code", async () => {
    const { inst, queued } = harness();
    inst
      .begin(
        facts({
          header: headers({
            Host: "app.example.com",
            "CF-IPCountry": "XX",
            "CloudFront-Viewer-Country": "de",
          }),
        }),
        [{}]
      )!
      .succeed({});
    expect((await queued[0]!.toWire(OFF))?.http?.country).toBe("DE");
  });
});

describe("HTTP failures", () => {
  it("records an HTTP failure without a JSON-RPC reply as an error without a code", async () => {
    const { inst, queued } = harness();
    inst.begin(facts(), [{}])!.failHttp(502);
    const event = await queued[0]!.toWire(ON);
    expect(event?.outcome).toBe("error");
    expect(event?.error).toEqual({ message: "HTTP 502" });
    // No JSON-RPC response reached the client.
    expect(event?.response_size).toBeUndefined();
    expect(event?.response_payload).toBeUndefined();
    expect(event?.request_payload).toBeDefined();
  });

  it("keeps the handler latency when the outcome is settled later", async () => {
    vi.useFakeTimers();
    try {
      const { inst, queued } = harness();
      const record = inst.begin(facts(), [{}])!;
      await vi.advanceTimersByTimeAsync(40);
      record.stopClock();
      await vi.advanceTimersByTimeAsync(500);
      record.respond({ result: {} });
      const event = await queued[0]!.toWire(OFF);
      expect(event?.duration_ms).toBeGreaterThanOrEqual(40);
      expect(event?.duration_ms).toBeLessThan(500);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("slow hooks", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const never = <T>() => new Promise<T>(() => undefined);

  async function settleWithin<T>(promise: Promise<T>, ms: number) {
    let value: { v: T } | undefined;
    void promise.then((v) => {
      value = { v };
    });
    await vi.advanceTimersByTimeAsync(ms);
    return value;
  }

  it("falls back to the default actor when identify() never settles", async () => {
    vi.useFakeTimers();
    const { inst, queued } = harness({ identify: () => never() });
    inst
      .begin(facts({ header: headers({ Authorization: "Bearer opaque-7" }) }), [
        {},
      ])!
      .succeed({});
    const wire = queued[0]!.toWire(OFF);
    expect(await settleWithin(wire, 1_000)).toBeUndefined();
    const settled = await settleWithin(wire, 1_100);
    expect(settled?.v?.actor).toEqual({
      token_hash: createHash("sha256").update("opaque-7").digest("hex"),
    });
  });

  it("sends no conversation id when conversationId() never settles", async () => {
    vi.useFakeTimers();
    const { inst, queued } = harness({ conversationId: () => never() });
    inst.begin(facts(), [{}])!.succeed({});
    const settled = await settleWithin(queued[0]!.toWire(OFF), 2_100);
    expect(settled).toBeDefined();
    expect(settled?.v?.conversation_id).toBeUndefined();
  });

  it("drops the event when an async redact() never settles, and applies it when it does", async () => {
    vi.useFakeTimers();
    const hung = harness({ redact: () => never() });
    hung.inst.begin(facts(), [{}])!.succeed({});
    const dropped = await settleWithin(hung.queued[0]!.toWire(OFF), 2_100);
    expect(dropped).toEqual({ v: null });

    const quick = harness({
      redact: async (event) => ({ ...event, target: "[hidden]" }),
    });
    quick.inst.begin(facts(), [{}])!.succeed({});
    const edited = await settleWithin(quick.queued[0]!.toWire(OFF), 1);
    expect(edited?.v?.target).toBe("[hidden]");
  });
});

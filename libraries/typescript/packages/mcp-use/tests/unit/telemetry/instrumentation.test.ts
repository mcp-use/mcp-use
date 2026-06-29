import { describe, expect, it, vi } from "vitest";
import {
  InstrumentationManager,
  manufactCloud,
  posthogAdapter,
  sanitizeInstrumentationEvent,
  type McpInstrumentationEvent,
  type PostHogCapturePayload,
} from "../../../src/telemetry/instrumentation.js";

const baseEvent: McpInstrumentationEvent = {
  eventId: "evt_1",
  name: "mcp.tool.call",
  timestamp: "2026-06-27T12:00:00.000Z",
  server: { name: "orders", version: "1.0.0" },
  transport: "http",
  session: { id: "sess_1" },
  client: { name: "cursor", version: "1.0.0" },
  actor: { subject: "user_1", roles: ["admin"] },
  method: "tools/call",
  resourceName: "search_orders",
  durationMs: 12,
  success: true,
  requestSize: 123,
  responseSize: 456,
  payloads: {
    request: {
      authorization: "Bearer secret",
      query: "abcdef",
      file: new Uint8Array([1, 2, 3]),
    },
  },
  attributes: {
    apiKey: "secret-key",
    nested: { token: "nested-secret", safe: "ok" },
  },
};

describe("InstrumentationManager", () => {
  it("normalizes events and forwards them to adapters", async () => {
    const onEvent = vi.fn();
    const manager = new InstrumentationManager({
      server: { name: "orders", version: "1.0.0" },
      adapters: [{ name: "test", onEvent }],
    });

    await manager.emit({
      name: "mcp.tool.call",
      method: "tools/call",
      success: true,
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: expect.any(String),
        timestamp: expect.any(String),
        name: "mcp.tool.call",
        server: { name: "orders", version: "1.0.0" },
        method: "tools/call",
        success: true,
      })
    );
  });
});

describe("sanitizeInstrumentationEvent", () => {
  it("drops payloads by default and redacts sensitive attributes", () => {
    const sanitized = sanitizeInstrumentationEvent(baseEvent);

    expect(sanitized.payloads).toBeUndefined();
    expect(sanitized.attributes).toEqual({
      apiKey: "[Redacted]",
      nested: { token: "[Redacted]", safe: "ok" },
    });
  });

  it("keeps payloads when enabled while redacting and truncating values", () => {
    const sanitized = sanitizeInstrumentationEvent(baseEvent, {
      capturePayloads: true,
      maxStringLength: 5,
    });

    expect(sanitized.payloads).toEqual({
      request: {
        authorization: "[Redacted]",
        query: "abcde...",
        file: "[Binary]",
      },
    });
  });
});

describe("manufactCloud", () => {
  it("posts sanitized batches with raw fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response("", { status: 202 })
    );
    const adapter = manufactCloud({
      serverId: "srv_1",
      writeKey: "write-key",
      endpoint: "https://example.test/telemetry",
      fetch: fetchMock,
      capturePayloads: true,
      sanitizer: { maxStringLength: 5 },
    });

    await adapter.onEvent(baseEvent);

    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("https://example.test/telemetry");
    expect(request?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        authorization: "Bearer write-key",
        "content-type": "application/json",
        "x-mcp-use-server-id": "srv_1",
      }),
    });

    const body = JSON.parse(String((request?.[1] as RequestInit).body)) as {
      server_id: string;
      batch: Array<Record<string, unknown>>;
    };
    expect(body).toEqual({
      server_id: "srv_1",
      batch: [
        expect.objectContaining({
          event_id: "evt_1",
          event: "mcp.tool.call",
          server_id: "srv_1",
          resource_name: "search_orders",
          payloads: {
            request: {
              authorization: "[Redacted]",
              query: "abcde...",
              file: "[Binary]",
            },
          },
          attributes: {
            apiKey: "[Redacted]",
            nested: { token: "[Redacted]", safe: "ok" },
          },
        }),
      ],
    });
  });

  it("flushes queued events and reuses shutdown as a final flush", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response("", { status: 202 })
    );
    const adapter = manufactCloud({
      serverId: "srv_1",
      writeKey: "write-key",
      endpoint: "https://example.test/telemetry",
      fetch: fetchMock,
      flushAt: 10,
    });

    await adapter.onEvent(baseEvent);
    expect(fetchMock).not.toHaveBeenCalled();

    await adapter.flush?.();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await adapter.shutdown?.();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("posthogAdapter", () => {
  it("captures mapped events with a BYO PostHog-like client", async () => {
    const posthog = {
      capture: vi.fn(),
      flush: vi.fn(),
      shutdown: vi.fn(),
    };
    const adapter = posthogAdapter(posthog, {
      capturePayloads: true,
      distinctId: (event) => event.actor?.subject,
      groups: { organization: "org_1" },
      beforeSend: (payload) => ({
        ...payload,
        properties: { ...payload.properties, custom: true },
      }),
    });

    await adapter.onEvent(baseEvent);

    const payload = posthog.capture.mock.calls[0]?.[0] as PostHogCapturePayload;
    expect(payload).toEqual({
      event: "$mcp_tool_call",
      distinctId: "user_1",
      properties: expect.objectContaining({
        event_id: "evt_1",
        mcp_event: "mcp.tool.call",
        server_name: "orders",
        session_id: "sess_1",
        $session_id: "sess_1",
        $groups: { organization: "org_1" },
        actor_subject: "user_1",
        resource_name: "search_orders",
        custom: true,
        payloads: {
          request: {
            authorization: "[Redacted]",
            query: "abcdef",
            file: "[Binary]",
          },
        },
        attributes: {
          apiKey: "[Redacted]",
          nested: { token: "[Redacted]", safe: "ok" },
        },
      }),
    });

    await adapter.flush?.();
    await adapter.shutdown?.();
    expect(posthog.flush).toHaveBeenCalledTimes(2);
    expect(posthog.shutdown).toHaveBeenCalledTimes(1);
  });

  it("lets beforeSend drop events", async () => {
    const posthog = { capture: vi.fn() };
    const adapter = posthogAdapter(posthog, {
      beforeSend: () => null,
    });

    await adapter.onEvent(baseEvent);

    expect(posthog.capture).not.toHaveBeenCalled();
  });
});

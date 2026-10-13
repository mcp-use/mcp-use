import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Event } from "@sentry/node";

const { events } = vi.hoisted(() => ({ events: [] as Event[] }));

// Use real Sentry spans/scopes, but collect events locally without a paid account.
vi.mock("@sentry/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sentry/node")>();
  return {
    ...actual,
    init: (options: Parameters<typeof actual.init>[0]) =>
      actual.init({
        ...options,
        dsn: "https://public@example.test/1",
        transport: () => ({
          send: async (envelope) => {
            for (const [headers, payload] of envelope[1]) {
              if (headers.type === "event" || headers.type === "transaction") {
                events.push(payload as Event);
              }
            }
            return { statusCode: 200 };
          },
          flush: async () => true,
        }),
      }),
  };
});

import * as Sentry from "@sentry/node";
import server from "../src/index.js";

async function request(method: string, params: object = {}) {
  const response = await server.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-03-26",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  );
  expect(response.status).toBe(200);
  const body = await response.text();
  const data = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? body
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : body;
  return JSON.parse(data ?? "{}");
}

async function call(outcome: string) {
  const response = await request("tools/call", {
    name: "monitored_report",
    arguments: { outcome },
  });
  await Sentry.flush(2_000);
  return response;
}

beforeAll(() => {
  vi.stubEnv("MCP_USE_ANONYMIZED_TELEMETRY", "false");
});

beforeEach(() => events.splice(0));

afterAll(async () => {
  await server.close();
  await Sentry.close(2_000);
  vi.unstubAllEnvs();
});

describe("Sentry tool instrumentation over MCP", () => {
  it("preserves successful output and records a successful transaction", async () => {
    const response = await call("success");
    expect(response.result.content[0].text).toContain("Report generated");
    expect(response.result.isError).not.toBe(true);
    expect(events.filter((event) => event.type !== "transaction")).toHaveLength(
      0
    );
    const transaction = events.find((event) => event.type === "transaction");
    expect(transaction?.transaction).toBe("tools/call monitored_report");
    expect(transaction?.contexts?.trace?.status).toBe("ok");
    expect(transaction?.contexts?.trace?.op).toBe("mcp.server");
  });

  it("reports returned tool errors without recording their contents", async () => {
    const response = await call("tool_error");
    expect(response.result.isError).toBe(true);
    const errors = events.filter((event) => event.type !== "transaction");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe(
      "MCP tool returned an error: monitored_report"
    );
    expect(errors[0]?.tags?.["mcp.tool.name"]).toBe("monitored_report");
    expect(JSON.stringify(events)).not.toContain(
      "Demo report could not be generated."
    );
    expect(
      events.find((event) => event.type === "transaction")?.contexts?.trace
        ?.status
    ).toBe("internal_error");
  });

  it("captures thrown exceptions once and preserves the MCP failure", async () => {
    const response = await call("exception");
    expect(
      response.result?.isError === true || response.error !== undefined
    ).toBe(true);
    const errors = events.filter((event) => event.type !== "transaction");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.exception?.values?.[0]?.value).toBe(
      "Demo report service unavailable"
    );
    expect(
      events.find((event) => event.type === "transaction")?.contexts?.trace
        ?.status
    ).toBe("internal_error");
  });

  it("does not instrument tool discovery or leak tags into the outer scope", async () => {
    await request("tools/list");
    await Sentry.flush(2_000);
    expect(events).toHaveLength(0);
    expect(
      Sentry.getIsolationScope().getScopeData().tags["mcp.tool.name"]
    ).toBeUndefined();
  });
});

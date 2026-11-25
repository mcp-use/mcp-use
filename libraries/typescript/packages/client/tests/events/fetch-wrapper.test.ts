import { describe, expect, it } from "vitest";
import { createSdkClientEventsAdapter } from "../../src/events/index.js";

function recorder() {
  const calls: Headers[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Headers(init?.headers));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

describe("Mcp-Name fetch wrapper", () => {
  it("sets exactly one Mcp-Name on modern events/poll, overwriting an SDK value", async () => {
    const { calls, fetchImpl } = recorder();
    const f = createSdkClientEventsAdapter().wrapFetch(fetchImpl);
    await f(
      "http://x/mcp",
      post(
        {
          jsonrpc: "2.0",
          id: "mcp-use:ev:1",
          method: "events/poll",
          params: { name: "note.created" },
        },
        { "mcp-protocol-version": "2026-07-28", "mcp-name": "note.created" }
      )
    );
    expect(calls[0]!.get("mcp-name")).toBe("note.created");
  });

  it("leaves legacy requests and events/list untouched", async () => {
    const { calls, fetchImpl } = recorder();
    const f = createSdkClientEventsAdapter().wrapFetch(fetchImpl);
    await f(
      "http://x/mcp",
      post(
        { jsonrpc: "2.0", id: 1, method: "events/poll", params: { name: "a" } },
        { "mcp-protocol-version": "2025-11-25" }
      )
    );
    await f(
      "http://x/mcp",
      post(
        { jsonrpc: "2.0", id: 2, method: "events/list", params: {} },
        { "mcp-protocol-version": "2026-07-28" }
      )
    );
    expect(calls.map((h) => h.get("mcp-name"))).toEqual([null, null]);
  });

  it("sets Mcp-Param-* from the cached descriptor", async () => {
    const { calls, fetchImpl } = recorder();
    const lane = createSdkClientEventsAdapter();
    lane.descriptors.set("issue.opened", {
      name: "issue.opened",
      delivery: ["poll"],
      inputSchema: {
        type: "object",
        properties: { repo: { type: "string", "x-mcp-header": "Repo" } },
      },
      payloadSchema: {},
    });
    await lane.wrapFetch(fetchImpl)(
      "http://x/mcp",
      post(
        {
          jsonrpc: "2.0",
          id: "mcp-use:ev:3",
          method: "events/subscribe",
          params: { name: "issue.opened", arguments: { repo: "acme/web" } },
        },
        { "mcp-protocol-version": "2026-07-28" }
      )
    );
    expect(calls[0]!.get("mcp-param-repo")).toBe("acme/web");
  });

  it("throws MCP_NAME_CONFLICT when a caller-supplied Mcp-Name disagrees", async () => {
    const { calls, fetchImpl } = recorder();
    const lane = createSdkClientEventsAdapter({
      headers: { "Mcp-Name": "other" },
    });
    await expect(
      lane.wrapFetch(fetchImpl)(
        "http://x/mcp",
        post(
          {
            jsonrpc: "2.0",
            id: "mcp-use:ev:1",
            method: "events/stream",
            params: { name: "a" },
          },
          { "mcp-protocol-version": "2026-07-28" }
        )
      )
    ).rejects.toMatchObject({ code: "MCP_NAME_CONFLICT" });
    expect(calls).toHaveLength(0);
  });

  it("omits Mcp-Name when the dialect does not send it", async () => {
    const { calls, fetchImpl } = recorder();
    const lane = createSdkClientEventsAdapter({
      dialect: { sendMcpName: false },
    });
    await lane.wrapFetch(fetchImpl)(
      "http://x/mcp",
      post(
        {
          jsonrpc: "2.0",
          id: "mcp-use:ev:1",
          method: "events/poll",
          params: { name: "a" },
        },
        { "mcp-protocol-version": "2026-07-28" }
      )
    );
    expect(calls[0]!.get("mcp-name")).toBe(null);
  });
});

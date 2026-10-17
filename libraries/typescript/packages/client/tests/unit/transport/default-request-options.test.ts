import type { JSONRPCRequest } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import { HttpConnector } from "../../../src/transport/http.js";

/**
 * Builds a legacy-protocol fetch stub that answers the handshake immediately
 * and routes every other request through `respond`.
 */
function fetchFixture(
  respond: (request: JSONRPCRequest) => Promise<object> | object
): typeof fetch {
  let toolsListed = false;
  return async (_input, init) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const request = JSON.parse(init!.body as string) as JSONRPCRequest;
    if (request.id === undefined) return new Response(null, { status: 202 });
    const reply = (result: object) =>
      Response.json({ jsonrpc: "2.0", id: request.id, result });
    if (request.method === "initialize") {
      return reply({
        protocolVersion: "2025-11-25",
        capabilities: {
          tools: {},
          prompts: {},
          resources: { subscribe: true },
          completions: {},
        },
        serverInfo: { name: "options-fixture", version: "1.0.0" },
      });
    }
    // Only the handshake's tools/list is answered; later ones go to `respond`.
    if (request.method === "tools/list" && !toolsListed) {
      toolsListed = true;
      return reply({ tools: [] });
    }
    return reply(await respond(request));
  };
}

const never = () => new Promise<object>(() => {});

describe("defaultRequestOptions", () => {
  it("applies the configured timeout to tool calls", async () => {
    const connector = new HttpConnector("http://options.invalid/mcp", {
      fetch: fetchFixture(never),
      protocolNegotiation: "legacy",
      detectMixedAuth: false,
      defaultRequestOptions: { timeout: 50 },
    });
    try {
      await connector.connect();
      await expect(connector.callTool("slow", {})).rejects.toThrow(
        /timed out/i
      );
    } finally {
      await connector.disconnect();
    }
  });

  it("applies the configured timeout to every helper method", async () => {
    const connector = new HttpConnector("http://options.invalid/mcp", {
      fetch: fetchFixture(never),
      protocolNegotiation: "legacy",
      detectMixedAuth: false,
      defaultRequestOptions: { timeout: 50 },
    });
    try {
      await connector.connect();
      // `listTools` and `listPrompts` are served from the SDK's list cache
      // after the handshake, so they never reach the transport here; they
      // share the same code path as the calls below.
      const calls: Array<() => Promise<unknown>> = [
        () => connector.listResources(),
        () => connector.listResourceTemplates(),
        () => connector.readResource("file:///x"),
        () => connector.subscribeToResource("file:///x"),
        () => connector.unsubscribeFromResource("file:///x"),
        () => connector.getPrompt("p", {}),
        () =>
          connector.complete({
            ref: { type: "ref/prompt", name: "p" },
            argument: { name: "a", value: "" },
          }),
        () => connector.request("custom/method"),
      ];
      for (const call of calls) {
        await expect(call()).rejects.toThrow(/timed out/i);
      }
    } finally {
      await connector.disconnect();
    }
  });

  it("lets per-call options override the configured defaults", async () => {
    const connector = new HttpConnector("http://options.invalid/mcp", {
      fetch: fetchFixture(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { content: [{ type: "text", text: "done" }] };
      }),
      protocolNegotiation: "legacy",
      detectMixedAuth: false,
      defaultRequestOptions: { timeout: 50 },
    });
    try {
      await connector.connect();
      const result = await connector.callTool("slow", {}, { timeout: 5000 });
      expect(result.content).toEqual([{ type: "text", text: "done" }]);
    } finally {
      await connector.disconnect();
    }
  });

  it("keeps the configured defaults when a per-call option is undefined", async () => {
    const connector = new HttpConnector("http://options.invalid/mcp", {
      fetch: fetchFixture(never),
      protocolNegotiation: "legacy",
      detectMixedAuth: false,
      defaultRequestOptions: { timeout: 50 },
    });
    try {
      await connector.connect();
      await expect(
        connector.callTool("slow", {}, { timeout: undefined })
      ).rejects.toThrow(/timed out/i);
    } finally {
      await connector.disconnect();
    }
  });

  it("adds the no-op onprogress for resetTimeoutOnProgress on every helper", async () => {
    const connector = new HttpConnector("http://options.invalid/mcp", {
      fetch: fetchFixture(async () => ({ contents: [] })),
      protocolNegotiation: "legacy",
      detectMixedAuth: false,
      defaultRequestOptions: { resetTimeoutOnProgress: true },
    });
    try {
      await connector.connect();
      const internals = connector as unknown as {
        client: {
          readResource: (...args: unknown[]) => Promise<unknown>;
          callTool: (...args: unknown[]) => Promise<unknown>;
        };
      };
      const readResource = vi
        .spyOn(internals.client, "readResource")
        .mockResolvedValue({ contents: [] });
      const callTool = vi
        .spyOn(internals.client, "callTool")
        .mockResolvedValue({ content: [] });
      await connector.readResource("file:///x");
      await connector.callTool("t", {});
      const withProgress = expect.objectContaining({
        resetTimeoutOnProgress: true,
        onprogress: expect.any(Function),
      });
      expect(readResource).toHaveBeenCalledWith(
        { uri: "file:///x" },
        withProgress
      );
      expect(callTool).toHaveBeenCalledWith(
        { name: "t", arguments: {} },
        withProgress
      );
    } finally {
      await connector.disconnect();
    }
  });

  it("passes the configured options to the automatic tools/list refresh", async () => {
    const connector = new HttpConnector("http://options.invalid/mcp", {
      fetch: fetchFixture(never),
      protocolNegotiation: "legacy",
      detectMixedAuth: false,
      defaultRequestOptions: { timeout: 50 },
    });
    try {
      await connector.connect();
      // The SDK serves `tools/list` from its list cache here, so assert on the
      // options handed to the SDK rather than on a transport timeout.
      const internals = connector as unknown as {
        client: { listTools: (...args: unknown[]) => Promise<unknown> };
        refreshToolsCache(): Promise<void>;
      };
      const listTools = vi
        .spyOn(internals.client, "listTools")
        .mockResolvedValue({ tools: [] });
      await internals.refreshToolsCache();
      expect(listTools).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ timeout: 50 })
      );
    } finally {
      await connector.disconnect();
    }
  });
});

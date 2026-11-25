import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import { MCPServer } from "../../src/index.js";
import type { EventRef } from "../../src/events/types.js";

async function rpc(
  server: MCPServer,
  method: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const response = await server.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "events-test",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    })
  );
  return (await response.json()) as Record<string, unknown>;
}

describe("a server with zero registered events", () => {
  it("answers every events/* method with -32601", async () => {
    const server = new MCPServer({
      name: "plain",
      version: "1.0.0",
      skills: false,
    });
    for (const method of [
      "events/list",
      "events/subscribe",
      "events/unsubscribe",
      "events/poll",
      "events/stream",
    ]) {
      expect(await rpc(server, method)).toMatchObject({
        error: { code: -32601 },
      });
    }
    // Something still works on the same server.
    expect(await rpc(server, "tools/list")).toMatchObject({
      result: { tools: [] },
    });
  });

  it("runs the Workers scheduled entrypoint as a no-op", async () => {
    const server = new MCPServer({
      name: "plain",
      version: "1.0.0",
      skills: false,
    });
    const waited: Promise<unknown>[] = [];
    await expect(
      server.scheduled({}, {}, { waitUntil: (p) => void waited.push(p) })
    ).resolves.toBeUndefined();
    expect(waited).toEqual([]);
  });

  it("does not advertise Events in server/discover", async () => {
    const server = new MCPServer({
      name: "plain",
      version: "1.0.0",
      skills: false,
    });
    const discover = await rpc(server, "server/discover");
    expect(JSON.stringify(discover)).not.toContain("events");
    expect(discover).toHaveProperty("result");
  });
});

describe("server.event typing", () => {
  it("infers emit's payload and the event's argument types", () => {
    const server = new MCPServer({ name: "typed", version: "1.0.0" });
    type Register = typeof server.event<
      "issue.opened",
      z.ZodObject<{ repo: z.ZodString }>,
      z.ZodObject<{ repo: z.ZodString; number: z.ZodNumber }>
    >;
    expectTypeOf<ReturnType<Register>>().toEqualTypeOf<
      EventRef<
        "issue.opened",
        { repo: string },
        { repo: string; number: number }
      >
    >();
    expectTypeOf<Parameters<ReturnType<Register>["emit"]>[0]>().toEqualTypeOf<{
      repo: string;
      number: number;
    }>();
  });
});

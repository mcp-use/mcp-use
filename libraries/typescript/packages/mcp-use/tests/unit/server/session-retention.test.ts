import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { mountMcp } from "../../../src/server/endpoints/mount-mcp.js";
import { MCPServer } from "../../../src/server/mcp-server.js";
import {
  InMemorySessionStore,
  InMemoryStreamManager,
} from "../../../src/server/sessions/index.js";

const accept = "application/json, text/event-stream";
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];

async function fixture(stateless = false) {
  const sessionStore = new InMemorySessionStore();
  const streamManager = new InMemoryStreamManager();
  const config = {
    name: "session-retention-test",
    version: "1.0.0",
    stateless,
    sessionIdleTimeoutMs: 0,
    sessionStore,
    streamManager,
  };
  const server = new MCPServer(config);
  server.tool(
    { name: "echo", description: "echo", schema: z.object({}) },
    async () => ({ content: [{ type: "text" as const, text: "ok" }] })
  );
  const createdServers: McpServer[] = [];
  const originalFactory = server.getServerForSession.bind(server);
  const createServer = vi
    .spyOn(server, "getServerForSession")
    .mockImplementation((sid) => {
      const created = originalFactory(sid);
      vi.spyOn(created, "close");
      createdServers.push(created);
      return created;
    });
  const app = new Hono();
  await mountMcp(app, server, server.sessions, config, true);

  async function initialize(endpoint = "/mcp", headers = { Accept: accept }) {
    const response = await app.request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "retention-client", version: "1.0.0" },
        },
      }),
    });
    expect(response.status).toBe(200);
    await response.text();
    return response.headers.get("mcp-session-id");
  }

  const result = {
    app,
    server,
    sessionStore,
    streamManager,
    createServer,
    createdServers,
    initialize,
  };
  fixtures.push(result);
  return result;
}

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await Promise.all(f.createdServers.map((server) => server.close()));
    await f.streamManager.close();
    await f.sessionStore.clear();
    f.server.sessions.clear();
    f.server.sessionRegisteredRefs.clear();
  }
  vi.restoreAllMocks();
});

describe.each(["/mcp", "/sse"])("session retention at %s", (endpoint) => {
  it.each([undefined, "application/json", "*/*", accept])(
    "deletes the original session with Accept %s",
    async (deleteAccept) => {
      const f = await fixture();
      const sid = (await f.initialize(endpoint))!;
      expect(f.server.sessions.size).toBe(1);
      expect(f.server.sessionRegisteredRefs.size).toBe(1);

      const sse = await f.app.request(endpoint, {
        headers: { Accept: "text/event-stream", "mcp-session-id": sid },
      });
      expect(sse.status).toBe(200);
      expect(await f.streamManager.has(sid)).toBe(true);

      const response = await f.app.request(endpoint, {
        method: "DELETE",
        headers: {
          "mcp-session-id": sid,
          ...(deleteAccept ? { Accept: deleteAccept } : {}),
        },
      });

      expect(response.status).toBe(200);
      expect(f.createServer).toHaveBeenCalledTimes(1);
      expect(f.server.sessions.size).toBe(0);
      expect(f.server.sessionRegisteredRefs.size).toBe(0);
      expect(await f.sessionStore.keys()).toEqual([]);
      expect(await f.streamManager.has(sid)).toBe(false);
      await sse.body?.cancel();
    }
  );

  it("rejects unknown and deleted session IDs without allocating a server", async () => {
    const f = await fixture();
    const sid = (await f.initialize(endpoint))!;
    for (const [id, status] of [
      ["unknown-session", 404],
      [sid, 200],
      [sid, 404],
    ] as const) {
      const response = await f.app.request(endpoint, {
        method: "DELETE",
        headers: { "mcp-session-id": id },
      });
      expect(response.status).toBe(status);
    }
    expect(f.createServer).toHaveBeenCalledTimes(1);
    expect(f.server.sessionRegisteredRefs.size).toBe(0);
  });

  it("does not accumulate references from rejected pre-initialization requests", async () => {
    const f = await fixture();
    for (let id = 1; id <= 5; id++) {
      const response = await f.app.request(endpoint, {
        method: "POST",
        headers: { Accept: accept, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "server/discover" }),
      });
      expect(response.status).toBe(400);
      expect(f.server.sessions.size).toBe(0);
      expect(f.server.sessionRegisteredRefs.size).toBe(0);
      expect(await f.sessionStore.keys()).toEqual([]);
      expect(f.createdServers.at(-1)!.close).toHaveBeenCalled();
    }
  });

  it("returns to baseline after 200 initialize/delete cycles", async () => {
    const f = await fixture();
    for (let cycle = 0; cycle < 200; cycle++) {
      const sid = (await f.initialize(endpoint))!;
      const response = await f.app.request(endpoint, {
        method: "DELETE",
        headers: { "mcp-session-id": sid },
      });
      expect(response.status).toBe(200);
      expect(f.server.sessions.size).toBe(0);
      expect(f.server.sessionRegisteredRefs.size).toBe(0);
      expect(await f.sessionStore.keys()).toEqual([]);
    }
  });

  it("deletes a persisted session whose local transport was lost", async () => {
    const f = await fixture();
    const sid = "persisted-session";
    await f.sessionStore.set(sid, { lastAccessedAt: Date.now() });
    const response = await f.app.request(endpoint, {
      method: "DELETE",
      headers: { "mcp-session-id": sid },
    });
    expect(response.status).toBe(200);
    expect(f.server.sessions.size).toBe(0);
    expect(f.server.sessionRegisteredRefs.size).toBe(0);
    expect(await f.sessionStore.has(sid)).toBe(false);
  });
});

describe("unsuccessful session allocation", () => {
  it.each([
    "{",
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  ])("cleans allocations for malformed initialization: %s", async (body) => {
    const f = await fixture();
    const response = await f.app.request("/mcp", {
      method: "POST",
      headers: { Accept: accept, "Content-Type": "application/json" },
      body,
    });
    expect(response.status).toBe(400);
    expect(f.server.sessions.size).toBe(0);
    expect(f.server.sessionRegisteredRefs.size).toBe(0);
    expect(f.createdServers[0].close).toHaveBeenCalled();
  });

  it.each(["connect", "handleRequest"])(
    "cleans allocations when %s throws",
    async (method) => {
      const f = await fixture();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      if (method === "handleRequest") {
        vi.spyOn(
          WebStandardStreamableHTTPServerTransport.prototype,
          "handleRequest"
        ).mockRejectedValueOnce(new Error("request failed"));
      } else {
        const original = f.createServer.getMockImplementation()!;
        f.createServer.mockImplementationOnce((sid) => {
          const created = original(sid);
          vi.spyOn(created, "connect").mockRejectedValueOnce(
            new Error("connect failed")
          );
          return created;
        });
      }
      const response = await f.app.request("/mcp", {
        method: "POST",
        headers: { Accept: accept, "Content-Type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(500);
      expect(f.server.sessions.size).toBe(0);
      expect(f.server.sessionRegisteredRefs.size).toBe(0);
      expect(f.createdServers[0].close).toHaveBeenCalled();
    }
  );

  it("cleans partial session registration when the session store fails", async () => {
    const f = await fixture();
    vi.spyOn(f.sessionStore, "set").mockRejectedValueOnce(
      new Error("store unavailable")
    );
    const response = await f.app.request("/mcp", {
      method: "POST",
      headers: { Accept: accept, "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });
    expect(response.status).toBe(400);
    expect(f.server.sessions.size).toBe(0);
    expect(f.server.sessionRegisteredRefs.size).toBe(0);
    expect(await f.sessionStore.keys()).toEqual([]);
    expect(f.createdServers[0].close).toHaveBeenCalled();
  });

  it("removes references even when server construction throws after registering them", async () => {
    const f = await fixture();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const original = f.createServer.getMockImplementation()!;
    f.createServer.mockImplementationOnce((sid) => {
      original(sid);
      throw new Error("factory failed");
    });
    const response = await f.app.request("/mcp", {
      method: "POST",
      headers: { Accept: accept, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(500);
    expect(f.server.sessions.size).toBe(0);
    expect(f.server.sessionRegisteredRefs.size).toBe(0);
  });

  it("finishes local cleanup even if an external cleanup operation fails", async () => {
    const f = await fixture();
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.spyOn(f.sessionStore, "delete").mockRejectedValueOnce(
      new Error("store unavailable")
    );
    const response = await f.app.request("/mcp", {
      method: "POST",
      headers: { Accept: accept, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(400);
    expect(f.server.sessions.size).toBe(0);
    expect(f.server.sessionRegisteredRefs.size).toBe(0);
    expect(f.createdServers[0].close).toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
  });

  it("discards an initialization whose request was aborted", async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort();
    await f.app.request("/mcp", {
      method: "POST",
      signal: controller.signal,
      headers: { Accept: accept, "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });
    expect(f.server.sessions.size).toBe(0);
    expect(f.server.sessionRegisteredRefs.size).toBe(0);
    expect(await f.sessionStore.keys()).toEqual([]);
    expect(f.createdServers[0].close).toHaveBeenCalled();
  });

  it.each([false, true])(
    "preserves stateless initialization (explicit=%s)",
    async (explicit) => {
      const f = await fixture(explicit);
      const sid = await f.initialize("/mcp", {
        Accept: explicit ? accept : "application/json",
      });
      expect(sid).toBeNull();
      expect(f.server.sessions.size).toBe(0);
      expect(f.server.sessionRegisteredRefs.size).toBe(0);
    }
  );

  it("keeps an established session after a later request is rejected", async () => {
    const f = await fixture();
    const sid = (await f.initialize())!;
    const response = await f.app.request("/mcp", {
      method: "POST",
      headers: {
        Accept: accept,
        "Content-Type": "application/json",
        "mcp-session-id": sid,
      },
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(f.server.sessions.has(sid)).toBe(true);
    expect(f.server.sessionRegisteredRefs.has(sid)).toBe(true);
    expect(await f.sessionStore.has(sid)).toBe(true);
    expect(f.createServer).toHaveBeenCalledTimes(1);
  });

  it("preserves v1's JSON-only request mode outside session deletion", async () => {
    const f = await fixture();
    const sid = (await f.initialize())!;
    const response = await f.app.request("/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "mcp-session-id": sid,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).result.tools[0].name).toBe("echo");
    expect(f.server.sessions.has(sid)).toBe(true);
    expect(f.server.sessionRegisteredRefs.size).toBe(1);
    expect(f.createServer).toHaveBeenCalledTimes(2);
  });
});

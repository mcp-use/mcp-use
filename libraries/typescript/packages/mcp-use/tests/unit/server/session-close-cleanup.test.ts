import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mountMcp } from "../../../src/server/endpoints/mount-mcp.js";
import { InMemorySessionStore } from "../../../src/server/sessions/stores/memory.js";
import { InMemoryStreamManager } from "../../../src/server/sessions/streams/memory.js";
import type { SessionData } from "../../../src/server/sessions/session-manager.js";

const servers: McpServer[] = [];
afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
  vi.restoreAllMocks();
});

describe.each(["new", "recovered"] as const)(
  "%s session close cleanup",
  (mode) => {
    it.each(["stream", "store", "both-and-hooks"] as const)(
      "releases local resources when %s cleanup fails",
      async (failureMode) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const app = new Hono();
        const sessions = new Map<string, SessionData>();
        const sessionStore = new InMemorySessionStore();
        const streamManager = new InMemoryStreamManager();
        const instance = {
          getServerForSession: vi.fn(() => {
            const server = new McpServer({
              name: "cleanup-test",
              version: "1.0.0",
            });
            servers.push(server);
            return server;
          }),
          cleanupSessionSubscriptions: vi.fn(),
          cleanupSessionRefs: vi.fn(),
        };
        await mountMcp(
          app,
          instance,
          sessions,
          {
            name: "cleanup-test",
            version: "1.0.0",
            sessionStore,
            streamManager,
            sessionIdleTimeoutMs: 0,
          },
          true
        );
        let sid = "recovered-session";
        if (mode === "recovered") {
          await sessionStore.set(sid, {
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
          });
        }
        const initial = await app.request("/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            ...(mode === "recovered" ? { "mcp-session-id": sid } : {}),
          },
          body: JSON.stringify(
            mode === "new"
              ? {
                  jsonrpc: "2.0",
                  id: 1,
                  method: "initialize",
                  params: {
                    protocolVersion: "2025-03-26",
                    capabilities: {},
                    clientInfo: { name: "test-client", version: "1.0.0" },
                  },
                }
              : { jsonrpc: "2.0", id: 1, method: "tools/list" }
          ),
        });
        expect(initial.status).toBe(200);
        await initial.text();
        if (mode === "new") sid = initial.headers.get("mcp-session-id")!;
        expect(sid).toBeTruthy();
        expect(sessions.has(sid)).toBe(true);
        const streamDelete = vi.spyOn(streamManager, "delete");
        const storeDelete = vi.spyOn(sessionStore, "delete");
        const failure = new Error("remote cleanup unavailable");
        if (failureMode !== "store") streamDelete.mockRejectedValue(failure);
        if (failureMode !== "stream") storeDelete.mockRejectedValue(failure);
        if (failureMode === "both-and-hooks")
          instance.cleanupSessionSubscriptions.mockImplementation(() => {
            throw failure;
          });
        const response = await app.request("/mcp", {
          method: "DELETE",
          headers: { "mcp-session-id": sid },
        });
        expect(response.status).toBe(200);
        expect(sessions.size).toBe(0);
        expect(streamDelete).toHaveBeenCalledWith(sid);
        expect(storeDelete).toHaveBeenCalledWith(sid);
        expect(instance.cleanupSessionSubscriptions).toHaveBeenCalledWith(sid);
        expect(instance.cleanupSessionRefs).toHaveBeenCalledWith(sid);
        expect(console.warn).toHaveBeenCalled();
      }
    );
  }
);

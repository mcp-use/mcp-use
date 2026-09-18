import type {
  JSONRPCRequest,
  Notification,
  Progress,
} from "@modelcontextprotocol/client";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { HttpConnector } from "../../../src/transport/http.js";

class TestHttpConnector extends HttpConnector {
  get sdkClient() {
    if (!this.client) throw new Error("Client is not connected");
    return this.client;
  }
}

describe("HTTP progress through the SDK", () => {
  it.each(["legacy", "modern"] as const)(
    "routes concurrent %s calls and forwards notifications once",
    async (era) => {
      const modern = era === "modern";
      const requests: JSONRPCRequest[] = [];
      const rounds = new Map<string, number>();
      const notifications: Notification[] = [];
      const lateNotifications: Notification[] = [];
      const fetchMock: typeof fetch = async (_input, init) => {
        if (init?.method === "GET") return new Response(null, { status: 405 });
        const request = JSON.parse(init!.body as string) as JSONRPCRequest;
        if (request.id === undefined)
          return new Response(null, { status: 202 });
        const complete = (result: object) =>
          modern ? { resultType: "complete", ...result } : result;
        const respond = (result: object) =>
          Response.json({ jsonrpc: "2.0", id: request.id, result });
        switch (request.method) {
          case "initialize":
            return respond({
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "progress-fixture", version: "1.0.0" },
            });
          case "server/discover":
            return respond(
              complete({
                supportedVersions: ["2026-07-28"],
                capabilities: { tools: {} },
                _meta: {
                  "io.modelcontextprotocol/serverInfo": {
                    name: "progress-fixture",
                    version: "1.0.0",
                  },
                },
              })
            );
          case "tools/call": {
            requests.push(request);
            const name = request.params!.name as string;
            const round = (rounds.get(name) ?? 0) + 1;
            rounds.set(name, round);
            const progressToken = (
              request.params!._meta as { progressToken: number }
            ).progressToken;
            const result =
              modern && round === 1
                ? {
                    resultType: "input_required",
                    inputRequests: {
                      confirm: {
                        method: "elicitation/create",
                        params: {
                          mode: "form",
                          message: "Continue?",
                          requestedSchema: { type: "object", properties: {} },
                        },
                      },
                    },
                    requestState: name,
                  }
                : complete({ content: [{ type: "text", text: name }] });
            const stream = new ReadableStream<Uint8Array>({
              async start(controller) {
                const emit = (message: object) =>
                  controller.enqueue(
                    new TextEncoder().encode(
                      `data: ${JSON.stringify(message)}\n\n`
                    )
                  );
                emit({
                  jsonrpc: "2.0",
                  method: "notifications/progress",
                  params: {
                    progressToken,
                    progress: round * 10,
                    message: name,
                  },
                });
                // A cancellation for an unrelated request must still reach
                // public listeners through the SDK's built-in handler.
                emit({
                  jsonrpc: "2.0",
                  method: "notifications/cancelled",
                  params: { requestId: `unrelated-${name}-${round}` },
                });
                await setImmediate();
                emit({ jsonrpc: "2.0", id: request.id, result });
                controller.close();
              },
            });
            return new Response(stream, {
              headers: { "content-type": "text/event-stream" },
            });
          }
          default:
            throw new Error(`Unexpected request: ${request.method}`);
        }
      };
      const connector = new TestHttpConnector("http://progress.invalid/mcp", {
        fetch: fetchMock,
        protocolNegotiation: modern ? { pin: "2026-07-28" } : "legacy",
        detectMixedAuth: false,
        onElicitation: async () => ({ action: "accept", content: {} }),
        onNotification: (notification) => {
          notifications.push(notification);
        },
      });
      try {
        await connector.connect();
        const errors = vi.fn();
        connector.sdkClient.onerror = errors;
        connector.onNotification((notification) => {
          lateNotifications.push(notification);
        });
        const progress: Record<string, Progress[]> = { first: [], second: [] };
        const results = await Promise.all(
          Object.keys(progress).map((name) =>
            connector.callTool(
              name,
              {},
              {
                onprogress: (event) => {
                  progress[name].push(event);
                },
                resetTimeoutOnProgress: true,
              }
            )
          )
        );
        expect(results.map((result) => result.content)).toEqual([
          [{ type: "text", text: "first" }],
          [{ type: "text", text: "second" }],
        ]);
        for (const name of Object.keys(progress)) {
          // The SDK also emits synthetic progress while fulfilling input.
          const serverProgress = progress[name].filter(
            (event) => !event.message?.startsWith("Fulfilling input")
          );
          expect(serverProgress).toEqual(
            (modern ? [10, 20] : [10]).map((value) => ({
              progress: value,
              message: name,
            }))
          );
        }
        expect(errors).not.toHaveBeenCalled();
        expect(notifications).toHaveLength(modern ? 8 : 4);
        expect(lateNotifications).toEqual(notifications);
        expect(new Set(requests.map((request) => request.id)).size).toBe(
          requests.length
        );
        for (const request of requests) {
          expect(request.params!._meta).toMatchObject({
            progressToken: request.id,
          });
        }
      } finally {
        await connector.disconnect();
      }
    }
  );
});

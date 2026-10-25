import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MCPClient } from "@mcp-use/client";
import { describe, expect, it } from "vitest";
import { MCPAgent } from "../../index.js";

describe("MCPAgent streaming response ownership", () => {
  it.each([
    {
      provider: "openai-compatible" as const,
      endpoint: "/v1/chat/completions",
      frame:
        'data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      contentType: "text/event-stream",
    },
    {
      provider: "ollama" as const,
      endpoint: "/api/chat",
      frame:
        '{"model":"local-fixture","message":{"role":"assistant","content":"Hello"},"done":false}\n',
      contentType: "application/x-ndjson",
    },
  ])(
    "closes the $provider request when its caller stops consuming text",
    async ({ provider, endpoint, frame, contentType }) => {
      let finish!: () => void;
      const disconnected = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const server = createServer((request, response) => {
        request.resume();
        if (request.method !== "POST" || request.url !== endpoint) {
          response.writeHead(404).end();
          return;
        }
        response.once("close", finish);
        response.writeHead(200, { "Content-Type": contentType });
        response.write(frame);
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const client = new MCPClient({ mcpServers: {} });
      const agent = new MCPAgent({
        client,
        llm: {
          provider,
          model: "local-fixture",
          apiKey: "local-fixture",
          baseUrl: provider === "ollama" ? origin : `${origin}/v1`,
        },
        autoInitialize: true,
        memoryEnabled: false,
        exposeResourcesAsTools: false,
        exposePromptsAsTools: false,
      });
      let deadline: ReturnType<typeof setTimeout> | undefined;

      try {
        let text = "";
        for await (const event of agent.streamEvents({ prompt: "Say hello" })) {
          if (event.type === "text-delta") {
            text += event.delta;
            break;
          }
        }
        expect(text).toBe("Hello");
        await Promise.race([
          disconnected,
          new Promise<never>((_, reject) => {
            deadline = setTimeout(
              () => reject(new Error("upstream response is still open")),
              2000
            );
          }),
        ]);
      } finally {
        clearTimeout(deadline);
        await agent.close();
        await client.closeAllSessions();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );
});

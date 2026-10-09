import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MCPClient } from "@mcp-use/client";
import { describe, expect, it } from "vitest";
import { MCPAgent } from "../../index.js";

describe("MCPAgent SSE line endings", () => {
  it.each([
    { name: "LF", separator: "\n\n" },
    { name: "CRLF", separator: "\r\n\r\n" },
    { name: "CR", separator: "\r\r" },
    { name: "LF then CRLF", separator: "\n\r\n" },
    { name: "CRLF then LF", separator: "\r\n\n" },
    { name: "LF then CR", separator: "\n\r" },
    { name: "CRLF then CR", separator: "\r\n\r" },
    { name: "CR then CRLF", separator: "\r\r\n" },
  ])("preserves model output with $name", async ({ separator }) => {
    let requests = 0;
    const server = createServer((request, response) => {
      request.resume();
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      requests++;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunks = ["Hello ", "世界", "!"].map((content) => ({
        id: "chatcmpl-local",
        object: "chat.completion.chunk",
        created: 0,
        model: "local-fixture",
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      }));
      const records = [
        ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`),
        "data: [DONE]",
      ];
      response.end(records.join(separator) + separator);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const client = new MCPClient({ mcpServers: {} });
    const agent = new MCPAgent({
      client,
      llm: {
        provider: "openai-compatible",
        model: "local-fixture",
        apiKey: "local-fixture",
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      },
      autoInitialize: true,
      memoryEnabled: false,
      exposeResourcesAsTools: false,
      exposePromptsAsTools: false,
    });

    try {
      let text = "";
      for await (const event of agent.streamEvents({
        prompt: "Say Hello 世界!",
        signal: AbortSignal.timeout(5000),
      })) {
        if (event.type === "text-delta") text += event.delta;
      }
      expect(requests).toBe(1);
      expect(text).toBe("Hello 世界!");
    } finally {
      await agent.close();
      await client.closeAllSessions();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

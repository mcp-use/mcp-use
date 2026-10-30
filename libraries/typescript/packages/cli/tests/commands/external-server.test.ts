import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { afterEach, expect, it } from "vitest";
import { validateExternalServer } from "../../src/commands/external-server.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function endpoint(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
}

it.each(["json", "sse"])(
  "accepts a real MCP handshake over %s",
  async (transport) => {
    const methods: string[] = [];
    const url = await endpoint((request, response) => {
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const message = JSON.parse(body);
        methods.push(message.method);
        if (message.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        const result =
          message.method === "initialize"
            ? {
                protocolVersion: message.params.protocolVersion,
                capabilities: {},
                serverInfo: { name: "fixture", version: "1.0.0" },
              }
            : message.method === "tools/list"
              ? { tools: [] }
              : { resources: [] };
        const payload = JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result,
        });
        if (transport === "sse") {
          response
            .writeHead(200, { "Content-Type": "text/event-stream" })
            .end(`event: message\ndata: ${payload}\n\n`);
        } else {
          response
            .writeHead(200, { "Content-Type": "application/json" })
            .end(payload);
        }
      });
    });
    await expect(validateExternalServer(url)).resolves.toBeUndefined();
    expect(methods).toContain("initialize");
  }
);

it.each([
  [405, "text/html", "<html>Method not allowed</html>"],
  [200, "text/html", "<html>A regular website</html>"],
  [200, "application/json", '{"message":"This is not MCP"}'],
] as const)(
  "rejects HTTP %i %s responses that are not MCP",
  async (status, contentType, body) => {
    const url = await endpoint((_request, response) => {
      response.writeHead(status, { "Content-Type": contentType }).end(body);
    });
    await expect(validateExternalServer(url)).rejects.toMatchObject({
      code: "invalid_mcp_server",
    });
  }
);

it("rejects a JSON-RPC response without the required MCP initialization fields", async () => {
  const url = await endpoint((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const message = JSON.parse(body);
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
    });
  });
  await expect(validateExternalServer(url)).rejects.toMatchObject({
    code: "invalid_mcp_server",
  });
});

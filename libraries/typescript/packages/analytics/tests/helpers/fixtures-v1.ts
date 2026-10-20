import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { instrument } from "../../src/index.js";
import type { AnalyticsOptions } from "../../src/types.js";
import { listen, type TestServer } from "./http.js";
import { FIXTURE, slowTool } from "./scenarios.js";

/** Register the shared fixture surface on an SDK v1 `McpServer`. */
export function registerV1Fixture(server: McpServer): McpServer {
  server.registerTool(
    FIXTURE.tools.echo,
    { inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] })
  );
  server.registerTool(FIXTURE.tools.fail, {}, async () => ({
    isError: true,
    content: [{ type: "text", text: "bad input" }],
  }));
  server.registerTool(FIXTURE.tools.explode, {}, async () => {
    throw new Error("kaput");
  });
  server.registerTool(FIXTURE.tools.slow, {}, async () => ({
    content: [{ type: "text", text: await slowTool() }],
  }));
  server.registerResource(
    "note",
    FIXTURE.resourceUri,
    { mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, text: "hello" }] })
  );
  server.registerPrompt(
    FIXTURE.prompt,
    { argsSchema: { name: z.string() } },
    ({ name }) => ({
      messages: [
        { role: "user", content: { type: "text", text: `Hello ${name}` } },
      ],
    })
  );
  return server;
}

/** A new instrumented v1 `McpServer`; `instrument()` runs twice, before any registration. */
export function v1Server(options: AnalyticsOptions): McpServer {
  const server = new McpServer({ name: "fixture-v1", version: "1.2.3" });
  instrument(server, options);
  instrument(server, options);
  return registerV1Fixture(server);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
}

/** Stateful streamable HTTP: one instrumented server per session. */
export function serveStateful(options: AnalyticsOptions): Promise<TestServer> {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  return listen((req, res) => {
    void (async () => {
      const body = req.method === "POST" ? await readJson(req) : undefined;
      const sessionId = req.headers["mcp-session-id"];
      let transport =
        typeof sessionId === "string" ? transports.get(sessionId) : undefined;
      if (transport === undefined && isInitializeRequest(body)) {
        const created = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, created);
          },
        });
        transport = created;
        await v1Server(options).connect(created);
      }
      if (transport === undefined) {
        res.writeHead(400).end();
        return;
      }
      await transport.handleRequest(req, res, body);
    })();
  });
}

/** Stateless streamable HTTP: a new server and transport for every request. */
export function serveStateless(options: AnalyticsOptions): Promise<TestServer> {
  return listen((req, res) => {
    void (async () => {
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      const body = await readJson(req);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const server = v1Server(options);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    })();
  });
}

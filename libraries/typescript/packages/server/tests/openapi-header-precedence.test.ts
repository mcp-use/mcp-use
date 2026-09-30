import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  MCPServer,
  type FromOpenAPIOptions,
  type OpenAPIDocument,
} from "../src/index.js";

const spec: OpenAPIDocument = {
  openapi: "3.1.0",
  info: { title: "Header precedence" },
  servers: [{ url: "https://upstream.example" }],
  paths: {
    "/check": {
      get: {
        operationId: "check",
        parameters: [
          { name: "x-api-key", in: "header", schema: { type: "string" } },
        ],
        responses: { "200": { description: "ok" } },
      },
    },
  },
};

describe("OpenAPI header precedence", () => {
  it.each([
    [
      "bearer overrides static casing",
      {
        headers: { Authorization: "old" },
        auth: { type: "bearer", token: "new" },
      },
      {},
      "authorization",
      "Bearer new",
    ],
    [
      "parameter overrides static casing",
      { headers: { "X-API-Key": "old" } },
      { "x-api-key": "parameter" },
      "x-api-key",
      "parameter",
    ],
    [
      "same-case bearer overwrite",
      {
        headers: { authorization: "old" },
        auth: { type: "bearer", token: "new" },
      },
      {},
      "authorization",
      "Bearer new",
    ],
    [
      "unrelated static header survives",
      { headers: { "X-Trace": "trace" } },
      {},
      "x-trace",
      "trace",
    ],
    [
      "unset auth leaves static header",
      {
        headers: { "X-API-Key": "old" },
        auth: { type: "header", name: "x-api-key", value: undefined },
      },
      {},
      "x-api-key",
      "old",
    ],
    [
      "auth overrides parameter casing",
      { auth: { type: "header", name: "X-API-Key", value: "new" } },
      { "x-api-key": "parameter" },
      "x-api-key",
      "new",
    ],
  ] as const)("%s", async (_name, options, args, header, expected) => {
    let outgoing: string | undefined;
    const upstream = createServer((request, response) => {
      outgoing = request.headers[header] as string | undefined;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve)
    );
    const address = upstream.address() as AddressInfo;
    const server = MCPServer.fromOpenAPI({
      spec,
      ...options,
      baseUrl: `http://127.0.0.1:${address.port}`,
    } as FromOpenAPIOptions);
    const started = await server.listen(0);
    const client = new Client(
      { name: "headers-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(started.url))
      );
      await client.callTool({ name: "check", arguments: args });
      expect(outgoing).toBe(expected);
    } finally {
      await client.close();
      await server.close();
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});

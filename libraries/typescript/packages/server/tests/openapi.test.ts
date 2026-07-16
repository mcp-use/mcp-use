/** End-to-end coverage for OpenAPI-generated tools over real MCP and upstream HTTP. */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MCPServer,
  type FromOpenAPIOptions,
  type OpenAPIDocument,
} from "../src/index.js";

interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

const captured: CapturedRequest[] = [];
let upstreamBaseUrl: string;
const upstream = createServer((request, response) => {
  void handleUpstreamRequest(request, response);
});

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  const address = upstream.address() as AddressInfo;
  upstreamBaseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    upstream.close((error) => (error ? reject(error) : resolve()));
  });
});

async function handleUpstreamRequest(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = await readRequestBody(request);
  captured.push({
    method: request.method ?? "",
    url: request.url ?? "",
    headers: request.headers,
    body,
  });

  if (request.url === "/v1/fail") {
    response.statusCode = 422;
    response.setHeader("content-type", "text/plain");
    response.end("upstream rejected the request");
    return;
  }
  if (request.method === "PATCH") {
    response.setHeader("content-type", "text/plain");
    response.end("updated");
    return;
  }

  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(
    JSON.stringify({
      ok: true,
      path: request.url,
      requestId: request.headers["x-request-id"],
    })
  );
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function createSpec(): OpenAPIDocument {
  return {
    openapi: "3.1.0",
    info: { title: "Test API", version: "2026-07-16" },
    servers: [{ url: upstreamBaseUrl }],
    paths: {
      "/todos/{id}": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        get: {
          operationId: "getTodo",
          summary: "Get a todo",
          tags: ["todos"],
          parameters: [
            {
              name: "include",
              in: "query",
              schema: { type: "string", enum: ["comments", "owner"] },
            },
            {
              name: "x-request-id",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "ok" } },
        },
        patch: {
          operationId: "updateTodo",
          summary: "Update a todo",
          tags: ["todos"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TodoUpdate" },
              },
            },
          },
          responses: { "200": { description: "ok" } },
        },
      },
      "/admin/stats": {
        get: {
          operationId: "getAdminStats",
          tags: ["admin"],
          responses: { "200": { description: "ok" } },
        },
      },
      "/fail": {
        get: {
          operationId: "failUpstream",
          responses: { "422": { description: "rejected" } },
        },
      },
    },
    components: {
      schemas: {
        TodoUpdate: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", description: "Todo title" },
            completed: { type: "boolean", nullable: true },
          },
          additionalProperties: false,
        },
      },
    },
  };
}

async function connect(
  server: MCPServer
): Promise<{ client: Client; close: () => Promise<void> }> {
  const started = await server.listen(0);
  const client = new Client(
    { name: "openapi-test-client", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } }
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(started.url)));
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("MCPServer.fromOpenAPI", () => {
  it("uses spec identity and registers only included operations", async () => {
    const server = MCPServer.fromOpenAPI({
      spec: createSpec(),
      tags: ["todos"],
      exclude: [{ operationId: "updateTodo" }],
    });
    const connection = await connect(server);
    try {
      expect(connection.client.getServerVersion()).toMatchObject({
        name: "Test API",
        version: "2026-07-16",
      });
      const { tools } = await connection.client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(["getTodo"]);
      expect(tools[0]?.description).toBe("Get a todo\n\nHTTP: GET /todos/{id}");
      expect(tools[0]?.inputSchema).toMatchObject({
        type: "object",
        required: ["id", "x-request-id"],
        properties: {
          id: { type: "string", description: "path parameter" },
          include: {
            type: "string",
            enum: ["comments", "owner"],
            description: "query parameter",
          },
        },
      });
    } finally {
      await connection.close();
    }
  });

  it("maps path, query, header, static headers, and bearer auth", async () => {
    captured.length = 0;
    const server = MCPServer.fromOpenAPI({
      spec: createSpec(),
      tags: ["todos"],
      exclude: [{ operationId: "updateTodo" }],
      headers: { "x-static": "always" },
      auth: { type: "bearer", token: "test-token" },
    });
    const connection = await connect(server);
    try {
      const invalid = await connection.client.callTool({
        name: "getTodo",
        arguments: { include: "comments", "x-request-id": "req-invalid" },
      });
      expect(invalid.isError).toBe(true);
      expect(captured).toHaveLength(0);

      const result = await connection.client.callTool({
        name: "getTodo",
        arguments: {
          id: "todo 123",
          include: "comments",
          "x-request-id": "req-1",
        },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        ok: true,
        path: "/v1/todos/todo%20123?include=comments",
        requestId: "req-1",
      });
      expect(captured[0]).toMatchObject({
        method: "GET",
        url: "/v1/todos/todo%20123?include=comments",
        body: "",
      });
      expect(captured[0]?.headers).toMatchObject({
        authorization: "Bearer test-token",
        "x-request-id": "req-1",
        "x-static": "always",
      });
    } finally {
      await connection.close();
    }
  });

  it("validates referenced JSON bodies and sends custom-header auth", async () => {
    captured.length = 0;
    const server = MCPServer.fromOpenAPI({
      spec: createSpec(),
      tags: ["todos"],
      exclude: [{ operationId: "getTodo" }],
      auth: { type: "header", name: "x-api-key", value: "secret" },
    });
    const connection = await connect(server);
    try {
      const { tools } = await connection.client.listTools();
      expect(tools[0]?.inputSchema).toMatchObject({
        properties: { body: { $ref: "#/$defs/TodoUpdate" } },
        $defs: {
          TodoUpdate: {
            type: "object",
            required: ["title"],
            properties: {
              completed: {
                anyOf: [{ type: "boolean" }, { type: "null" }],
              },
            },
          },
        },
      });

      const invalid = await connection.client.callTool({
        name: "updateTodo",
        arguments: { id: "todo_123", body: { completed: true } },
      });
      expect(invalid.isError).toBe(true);
      expect(captured).toHaveLength(0);

      const result = await connection.client.callTool({
        name: "updateTodo",
        arguments: {
          id: "todo_123",
          body: { title: "Updated", completed: null },
        },
      });
      expect(result.content).toEqual([{ type: "text", text: "updated" }]);
      expect(captured[0]).toMatchObject({
        method: "PATCH",
        url: "/v1/todos/todo_123",
        body: JSON.stringify({ title: "Updated", completed: null }),
      });
      expect(captured[0]?.headers).toMatchObject({
        "content-type": "application/json",
        "x-api-key": "secret",
      });
    } finally {
      await connection.close();
    }
  });

  it("turns non-success upstream responses into tool errors", async () => {
    const server = MCPServer.fromOpenAPI({ spec: createSpec() });
    const connection = await connect(server);
    try {
      const result = await connection.client.callTool({
        name: "failUpstream",
        arguments: {},
      });
      expect(result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "upstream rejected the request" }],
      });
    } finally {
      await connection.close();
    }
  });

  it("creates deterministic fallback names and deduplicates collisions", async () => {
    const options: FromOpenAPIOptions = {
      baseUrl: upstreamBaseUrl,
      spec: {
        openapi: "3.1.0",
        info: { title: "Naming API" },
        paths: {
          "/reports/{id}": {
            get: { responses: { "200": { description: "ok" } } },
            post: { responses: { "200": { description: "ok" } } },
          },
          "/first": {
            get: {
              operationId: "getReport",
              responses: { "200": { description: "ok" } },
            },
          },
          "/second": {
            get: {
              operationId: "getReport",
              responses: { "200": { description: "ok" } },
            },
          },
        },
      },
    };
    const connection = await connect(MCPServer.fromOpenAPI(options));
    try {
      const { tools } = await connection.client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        "get_reports_id",
        "post_reports_id",
        "getReport",
        "getReport_2",
      ]);
      expect(connection.client.getServerVersion()?.version).toBe("1.0.0");
    } finally {
      await connection.close();
    }
  });
});

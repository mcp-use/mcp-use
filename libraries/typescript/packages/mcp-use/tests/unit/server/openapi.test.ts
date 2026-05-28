import { describe, expect, it, vi } from "vitest";
import { MCPServer, type OpenAPIDocument } from "../../../src/server/index.js";

const spec: OpenAPIDocument = {
  openapi: "3.1.0",
  info: {
    title: "Test API",
    version: "2026-05-27",
  },
  servers: [{ url: "https://api.example.com/v1" }],
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
            schema: {
              type: "string",
              enum: ["comments", "owner"],
            },
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
  },
  components: {
    schemas: {
      TodoUpdate: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", description: "Todo title" },
          completed: { type: "boolean" },
        },
      },
    },
  },
};

describe("MCPServer.fromOpenAPI", () => {
  it("registers included OpenAPI operations as tools", () => {
    const server = MCPServer.fromOpenAPI({
      spec,
      tags: ["todos"],
      exclude: [{ operationId: "updateTodo" }],
    });

    expect(server.config.name).toBe("Test API");
    expect(server.config.version).toBe("2026-05-27");
    expect(server.registeredTools).toEqual(["getTodo"]);
  });

  it("creates deterministic fallback names without collisions", () => {
    const server = MCPServer.fromOpenAPI({
      spec: {
        openapi: "3.1.0",
        info: { title: "Fallback API", version: "1.0.0" },
        paths: {
          "/reports/{id}": {
            get: {
              responses: { "200": { description: "ok" } },
            },
            post: {
              responses: { "200": { description: "ok" } },
            },
          },
        },
      },
      baseUrl: "https://api.example.com",
    });

    expect(server.registeredTools).toEqual([
      "get_reports_id",
      "post_reports_id",
    ]);
  });

  it("deduplicates colliding operationIds", () => {
    const server = MCPServer.fromOpenAPI({
      spec: {
        openapi: "3.1.0",
        info: { title: "Collision API", version: "1.0.0" },
        paths: {
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
      baseUrl: "https://api.example.com",
    });

    expect(server.registeredTools).toEqual(["getReport", "getReport_2"]);
  });

  it("creates Zod input schemas from parameters and local refs", () => {
    const server = MCPServer.fromOpenAPI({ spec, tags: ["todos"] });
    const getTodo = server.registrations.tools.get("getTodo");
    const updateTodo = server.registrations.tools.get("updateTodo");

    expect(getTodo?.config.schema?.safeParse({ id: "todo_123" }).success).toBe(
      true
    );
    expect(getTodo?.config.schema?.safeParse({}).success).toBe(false);
    expect(
      updateTodo?.config.schema?.safeParse({
        id: "todo_123",
        body: { title: "Buy milk" },
      }).success
    ).toBe(true);
    expect(
      updateTodo?.config.schema?.safeParse({
        id: "todo_123",
        body: { completed: true },
      }).success
    ).toBe(false);
  });

  it("calls the target API with path, query, body, and auth mapping", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ id: "todo_123" }), {
        headers: { "content-type": "application/json" },
      });
    });
    const server = MCPServer.fromOpenAPI({
      spec,
      auth: { type: "bearer", token: "test-token" },
      fetch: fetchMock,
    });

    const getTodo = server.registrations.tools.get("getTodo");
    const result = await getTodo?.handler({
      id: "todo 123",
      include: "comments",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/todos/todo%20123?include=comments",
      {
        method: "GET",
        headers: { authorization: "Bearer test-token" },
        body: undefined,
      }
    );
    expect(result?.structuredContent).toEqual({ id: "todo_123" });
  });

  it("sends JSON request bodies", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("updated", {
        headers: { "content-type": "text/plain" },
      });
    });
    const server = MCPServer.fromOpenAPI({ spec, fetch: fetchMock });
    const updateTodo = server.registrations.tools.get("updateTodo");

    const result = await updateTodo?.handler({
      id: "todo_123",
      body: { title: "Updated" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/todos/todo_123",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated" }),
      }
    );
    expect(result?.content).toEqual([{ type: "text", text: "updated" }]);
  });
});

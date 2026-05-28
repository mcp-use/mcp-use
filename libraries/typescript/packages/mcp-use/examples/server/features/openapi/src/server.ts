import { MCPServer, type OpenAPIDocument } from "mcp-use/server";

const PORT = Number(process.env.PORT ?? 3010);
const baseUrl = `http://localhost:${PORT}/api`;

const openapiSpec: OpenAPIDocument = {
  openapi: "3.1.0",
  info: {
    title: "Todo OpenAPI Example",
    version: "1.0.0",
  },
  servers: [{ url: baseUrl }],
  paths: {
    "/todos": {
      get: {
        operationId: "listTodos",
        summary: "List todos",
        description: "Return the example todos, optionally filtered by status.",
        tags: ["todos"],
        parameters: [
          {
            name: "completed",
            in: "query",
            required: false,
            description: "Filter todos by completion state.",
            schema: { type: "boolean" },
          },
        ],
        responses: {
          "200": {
            description: "Todo list",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Todo" },
                },
              },
            },
          },
        },
      },
    },
    "/todos/{id}": {
      get: {
        operationId: "getTodo",
        summary: "Get a todo",
        description: "Return one todo by id.",
        tags: ["todos"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Todo id.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Todo",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Todo" },
              },
            },
          },
        },
      },
      patch: {
        operationId: "updateTodo",
        summary: "Update a todo",
        description: "Update the title or completion state for one todo.",
        tags: ["todos"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Todo id.",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TodoUpdate" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated todo",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Todo" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Todo: {
        type: "object",
        required: ["id", "title", "completed"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          completed: { type: "boolean" },
        },
      },
      TodoUpdate: {
        type: "object",
        properties: {
          title: { type: "string", description: "New todo title." },
          completed: {
            type: "boolean",
            description: "Whether the todo is complete.",
          },
        },
      },
    },
  },
};

type Todo = {
  id: string;
  title: string;
  completed: boolean;
};

const todos = new Map<string, Todo>([
  ["todo-1", { id: "todo-1", title: "Write the OpenAPI spec", completed: true }],
  [
    "todo-2",
    { id: "todo-2", title: "Generate MCP tools from it", completed: false },
  ],
]);

const server = MCPServer.fromOpenAPI({
  spec: openapiSpec,
  baseUrl,
});

server.app.get("/api/todos", (c) => {
  const completed = c.req.query("completed");
  const allTodos = [...todos.values()];
  const filtered =
    completed === undefined
      ? allTodos
      : allTodos.filter((todo) => String(todo.completed) === completed);

  return c.json(filtered);
});

server.app.get("/api/todos/:id", (c) => {
  const todo = todos.get(c.req.param("id"));
  if (!todo) {
    return c.json({ error: "Todo not found" }, 404);
  }

  return c.json(todo);
});

server.app.patch("/api/todos/:id", async (c) => {
  const id = c.req.param("id");
  const todo = todos.get(id);
  if (!todo) {
    return c.json({ error: "Todo not found" }, 404);
  }

  const patch = (await c.req.json()) as Partial<Pick<Todo, "title" | "completed">>;
  const updated = { ...todo, ...patch };
  todos.set(id, updated);

  return c.json(updated);
});

await server.listen(PORT);

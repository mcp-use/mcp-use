# Common Patterns

Complete end-to-end examples showing server + widget implementations for common use cases.

**Examples:** Weather app, Todo list, Recipe browser, File manager

---

## Weather app

### Server (`index.tsx`)

```tsx
/** @jsxImportSource mcp-use/jsx */
import { MCPServer, text, object, error } from "mcp-use/server";
import { z } from "zod";
import WeatherDisplay from "./components/WeatherDisplay";

const server = new MCPServer({
  name: "weather-server",
  title: "Weather Server",
  version: "1.0.0",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
});

const weatherData: Record<string, { temp: number; conditions: string; icon: string }> = {
  "New York": { temp: 22, conditions: "Partly Cloudy", icon: "⛅" },
  "London": { temp: 15, conditions: "Rainy", icon: "🌧️" },
  "Tokyo": { temp: 28, conditions: "Sunny", icon: "☀️" },
  "Paris": { temp: 18, conditions: "Overcast", icon: "☁️" },
  "Sydney": { temp: 25, conditions: "Clear", icon: "🌤️" },
};

server.tool(
  {
    name: "get-weather",
    description: "Get current weather for a city",
    schema: z.object({
      city: z.string().describe("City name (e.g., 'New York', 'Tokyo')"),
    }),
  },
  async ({ city }) => {
    const data = weatherData[city];
    if (!data) {
      return error(
        `No weather data for ${city}. Available cities: ${Object.keys(weatherData).join(", ")}`
      );
    }
    const timestamp = new Date().toISOString();
    return (
      <WeatherDisplay
        city={city}
        temp={data.temp}
        conditions={data.conditions}
        icon={data.icon}
        timestamp={timestamp}
        _output={text(`Weather in ${city}: ${data.temp}°C, ${data.conditions}`)}
        _invoking="Fetching weather..."
        _invoked="Weather loaded"
      />
    );
  }
);

server.resource(
  {
    name: "available_cities",
    uri: "weather://cities",
    title: "Available Cities",
    description: "List of cities with weather data",
  },
  async () => object({ cities: Object.keys(weatherData) })
);

server.listen();
```

### Widget (`components/WeatherDisplay.tsx`)

```tsx
import { McpUseProvider, useWidget, useWidgetTheme } from "mcp-use/react";

export type WeatherProps = {
  city: string;
  temp: number;
  conditions: string;
  icon: string;
  timestamp: string;
};

export default function WeatherDisplay() {
  const { props, isPending } = useWidget<WeatherProps>();
  const theme = useWidgetTheme();

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🌍</div>
          <p>Loading weather...</p>
        </div>
      </McpUseProvider>
    );
  }

  const bgColor = theme === "dark" ? "#1e1e1e" : "#ffffff";
  const textColor = theme === "dark" ? "#e0e0e0" : "#1a1a1a";
  const secondaryColor = theme === "dark" ? "#b0b0b0" : "#666";

  return (
    <McpUseProvider autoSize>
      <div
        style={{
          padding: 24,
          backgroundColor: bgColor,
          color: textColor,
          borderRadius: 8,
        }}
      >
        <h2 style={{ margin: "0 0 8px 0", fontSize: 24 }}>{props.city}</h2>
        <p style={{ margin: "0 0 20px 0", color: secondaryColor, fontSize: 12 }}>
          {new Date(props.timestamp).toLocaleString()}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 64 }}>{props.icon}</div>
          <div>
            <div style={{ fontSize: 48, fontWeight: "bold" }}>{props.temp}°C</div>
            <div style={{ fontSize: 18, color: secondaryColor }}>{props.conditions}</div>
          </div>
        </div>
      </div>
    </McpUseProvider>
  );
}
```

---

## Todo List

### Server (`index.tsx`)

```tsx
/** @jsxImportSource mcp-use/jsx */
import { MCPServer, text, object, error } from "mcp-use/server";
import { z } from "zod";
import TodoList from "./components/TodoList";

const server = new MCPServer({
  name: "todo-server",
  title: "Todo Server",
  version: "1.0.0"
});

// Mock database
let todos: Array<{ id: string; title: string; completed: boolean }> = [
  { id: "1", title: "Learn MCP", completed: true },
  { id: "2", title: "Build first widget", completed: false },
  { id: "3", title: "Deploy server", completed: false }
];

server.tool(
  {
    name: "list-todos",
    description: "List all todos",
    schema: z.object({}),
  },
  async () => (
    <TodoList
      todos={todos}
      totalCount={todos.length}
      completedCount={todos.filter((t) => t.completed).length}
      _output={text(
        `Found ${todos.length} todos (${todos.filter((t) => t.completed).length} completed)`
      )}
      _invoking="Loading todos..."
      _invoked="Todos loaded"
    />
  )
);

// Tool: Create todo
server.tool(
  {
    name: "create-todo",
    description: "Create a new todo",
    schema: z.object({
      title: z.string().describe("Todo title")
    })
  },
  async ({ title }) => {
    const newTodo = {
      id: Date.now().toString(),
      title,
      completed: false
    };

    todos.push(newTodo);

    return text(`Created todo: ${title}`);
  }
);

// Tool: Toggle todo
server.tool(
  {
    name: "toggle-todo",
    description: "Toggle todo completion status",
    schema: z.object({
      id: z.string().describe("Todo ID"),
      completed: z.boolean().describe("New completion status")
    })
  },
  async ({ id, completed }) => {
    const todo = todos.find(t => t.id === id);

    if (!todo) {
      return error(`Todo not found: ${id}`);
    }

    todo.completed = completed;

    return text(`Todo ${completed ? "completed" : "uncompleted"}`);
  }
);

// Tool: Delete todo
server.tool(
  {
    name: "delete-todo",
    description: "Delete a todo",
    schema: z.object({
      id: z.string().describe("Todo ID")
    }),
    annotations: {
      destructiveHint: true
    }
  },
  async ({ id }) => {
    const index = todos.findIndex(t => t.id === id);

    if (index === -1) {
      return error(`Todo not found: ${id}`);
    }

    const deleted = todos.splice(index, 1)[0];

    return text(`Deleted todo: ${deleted.title}`);
  }
);

server.listen();
```

### Widget (`components/TodoList.tsx`)

```tsx
import { useState } from "react";
import { McpUseProvider, useWidget, useWidgetTheme, useCallTool } from "mcp-use/react";

type Todo = { id: string; title: string; completed: boolean };

export default function TodoList() {
  const { props, isPending } = useWidget<{
    todos: Todo[];
    totalCount: number;
    completedCount: number;
  }>();
  const theme = useWidgetTheme();
  const { callTool: createTodo, isPending: isCreating } = useCallTool("create-todo");
  const { callTool: toggleTodo } = useCallTool("toggle-todo");
  const { callTool: deleteTodo } = useCallTool("delete-todo");
  const [newTodo, setNewTodo] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 20 }}>Loading todos...</div>
      </McpUseProvider>
    );
  }

  // Theme-aware colors (see ui-guidelines.md for useColors() hook pattern)
  const colors = {
    bg: theme === "dark" ? "#1e1e1e" : "#ffffff",
    text: theme === "dark" ? "#e0e0e0" : "#1a1a1a",
    border: theme === "dark" ? "#404040" : "#e0e0e0",
    hover: theme === "dark" ? "#2a2a2a" : "#f5f5f5"
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodo.trim()) return;

    createTodo({ title: newTodo }, {
      onSuccess: () => setNewTodo(""),
      onError: () => alert("Failed to create todo"),
    });
  };

  const handleToggle = (id: string, completed: boolean) => {
    toggleTodo({ id, completed: !completed });
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    deleteTodo({ id }, {
      onError: () => alert("Failed to delete"),
      onSettled: () => setDeletingId(null),
    });
  };

  return (
    <McpUseProvider autoSize>
      <div style={{ padding: 20, backgroundColor: colors.bg, color: colors.text }}>
        <h2 style={{ margin: "0 0 8px 0" }}>
          Todos ({props.completedCount}/{props.totalCount})
        </h2>

        {/* Create form */}
        <form onSubmit={handleCreate} style={{ marginBottom: 16, display: "flex", gap: 8 }}>
          <input
            type="text"
            value={newTodo}
            onChange={e => setNewTodo(e.target.value)}
            placeholder="New todo..."
            disabled={isCreating}
            style={{
              flex: 1,
              padding: 8,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              backgroundColor: colors.bg,
              color: colors.text
            }}
          />
          <button
            type="submit"
            disabled={isCreating}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: 4,
              backgroundColor: "#0066cc",
              color: "white",
              cursor: isCreating ? "not-allowed" : "pointer"
            }}
          >
            {isCreating ? "Adding..." : "Add"}
          </button>
        </form>

        {/* Todo list */}
        <div>
          {props.todos.map(todo => (
            <div
              key={todo.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 12,
                borderBottom: `1px solid ${colors.border}`,
                backgroundColor: colors.bg
              }}
            >
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => handleToggle(todo.id, todo.completed)}
                style={{ cursor: "pointer" }}
              />
              <span style={{
                flex: 1,
                textDecoration: todo.completed ? "line-through" : "none",
                opacity: todo.completed ? 0.6 : 1
              }}>
                {todo.title}
              </span>
              <button
                onClick={() => handleDelete(todo.id)}
                disabled={deletingId === todo.id}
                style={{
                  padding: "4px 12px",
                  border: "none",
                  borderRadius: 4,
                  backgroundColor: "transparent",
                  color: "#dc3545",
                  cursor: deletingId === todo.id ? "not-allowed" : "pointer"
                }}
              >
                {deletingId === todo.id ? "..." : "Delete"}
              </button>
            </div>
          ))}
        </div>

        {props.todos.length === 0 && (
          <p style={{ textAlign: "center", color: colors.border, padding: 40 }}>
            No todos yet. Create one above!
          </p>
        )}
      </div>
    </McpUseProvider>
  );
}
```

---

## Recipe browser

Use the same **inline JSX** pattern as the weather and todo examples: compute data in the tool handler, then `return <RecipeBrowser ... _output={text(...)} />`. Implement master–detail layout and `useWidgetTheme()` inside `components/RecipeBrowser.tsx`. See [../widgets/basics.md](../widgets/basics.md).

---

## Key Patterns Demonstrated

### 1. **Mock Data First**
All examples use mock data, making it easy to prototype and test before connecting real APIs.

### 2. **Tool + JSX widget**
Each example pairs `server.tool()` with a JSX return and `_output` for the model.

### 3. **Interactive Actions**
Todo list shows create/update/delete operations from within widgets using `useCallTool()`.

### 4. **Theme Support**
All widgets use `useWidgetTheme()` to adapt to light/dark mode.

### 5. **State Management**
Recipe browser demonstrates local widget state (selected recipe, filters) vs server state (recipe data).

### 6. **Error Handling**
Weather app shows proper error responses when data not found.

### 7. **Loading States**
All widgets check `isPending` and show loading UI.

### 8. **Master-Detail Layout**
Recipe browser shows a master-detail pattern with list + detail view.

---

## Expanding These Examples

### Add Real APIs
Replace mock data with API calls:

```tsx
/** @jsxImportSource mcp-use/jsx */
// Weather with real API — return <WeatherDisplay ... _output={text(...)} /> after fetch.
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
server.tool(
  { name: "get-weather", schema: z.object({ city: z.string() }) },
  async ({ city }) => {
    if (!WEATHER_API_KEY) {
      return error("WEATHER_API_KEY not configured. Set it in environment variables.");
    }
    const response = await fetch(
      `https://api.weatherapi.com/v1/current.json?key=${WEATHER_API_KEY}&q=${city}`
    );
    if (!response.ok) {
      return error(`Weather API error: ${response.statusText}`);
    }
    const data = await response.json();
    return (
      <WeatherDisplay
        city={data.location.name}
        temp={data.current.temp_c}
        conditions={data.current.condition.text}
        icon={data.current.condition.icon}
        timestamp={data.current.last_updated}
        _output={text(
          `Weather in ${city}: ${data.current.temp_c}°C, ${data.current.condition.text}`
        )}
      />
    );
  }
);
```

### Add Database
Replace in-memory data with database:

```tsx
/** @jsxImportSource mcp-use/jsx */
import { Database } from "better-sqlite3";

const db = new Database("todos.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )
`);

server.tool({ name: "list-todos", schema: z.object({}) }, async () => {
  const todos = db.prepare("SELECT * FROM todos ORDER BY created_at DESC").all();
  const rows = todos.map((t) => ({ ...t, completed: Boolean(t.completed) }));
  return (
    <TodoList
      todos={rows}
      totalCount={todos.length}
      completedCount={todos.filter((t) => t.completed).length}
      _output={text(`Found ${todos.length} todos`)}
    />
  );
});
```

---

## Next Steps

- **Review server concepts** → [../server/tools.md](../server/tools.md)
- **Learn widget basics** → [../widgets/basics.md](../widgets/basics.md)
- **Check best practices** → [../../SKILL.md](../../SKILL.md)

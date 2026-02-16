# Widget Interactivity

Widgets can call MCP tools using the `callTool()` function from `useWidget()`. This enables buttons, forms, and actions within widgets.

**Use callTool() for:** Creating items, updating data, triggering actions, submitting forms

---

## callTool() Basics

The `callTool()` function from `useWidget()` calls any MCP tool from your server:

```tsx
const { callTool } = useWidget();

// Call a tool
await callTool("tool-name", { param: "value" });
```

**Signature:**
```typescript
callTool(
  toolName: string,
  params: Record<string, any>
): Promise<ToolResponse>
```

---

## Simple Button Action

```tsx
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

export const widgetMetadata: WidgetMetadata = {
  description: "Todo list with actions",
  props: z.object({
    todos: z.array(z.object({
      id: z.string(),
      title: z.string(),
      completed: z.boolean()
    }))
  }),
  exposeAsTool: false
};

export default function TodoList() {
  const { props, isPending, callTool } = useWidget();

  if (isPending) {
    return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;
  }

  const handleToggle = async (id: string, completed: boolean) => {
    await callTool("toggle-todo", { id, completed: !completed });
  };

  return (
    <McpUseProvider autoSize>
      <div>
        {props.todos.map(todo => (
          <div key={todo.id} style={{ display: "flex", gap: 8, padding: 8 }}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => handleToggle(todo.id, todo.completed)}
            />
            <span style={{ textDecoration: todo.completed ? "line-through" : "none" }}>
              {todo.title}
            </span>
          </div>
        ))}
      </div>
    </McpUseProvider>
  );
}
```

**Corresponding tool:**
```typescript
server.tool(
  {
    name: "toggle-todo",
    description: "Toggle todo completion status",
    schema: z.object({
      id: z.string(),
      completed: z.boolean()
    })
  },
  async ({ id, completed }) => {
    await updateTodo(id, { completed });
    return text(`Todo ${completed ? "completed" : "uncompleted"}`);
  }
);
```

---

## Form Submission

```tsx
import { useState } from "react";

export default function CreateItemWidget() {
  const { props, isPending, callTool } = useWidget();
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (isPending) {
    return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) return;

    setSubmitting(true);
    try {
      await callTool("create-todo", { title });
      setTitle("");  // Clear form on success
    } catch (error) {
      console.error("Failed to create todo:", error);
      alert("Failed to create todo");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <McpUseProvider autoSize>
      <div style={{ padding: 20 }}>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="New todo..."
            disabled={submitting}
            style={{ padding: 8, width: 300, marginRight: 8 }}
          />
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Add Todo"}
          </button>
        </form>

        <div style={{ marginTop: 16 }}>
          {props.todos.map(todo => (
            <div key={todo.id}>{todo.title}</div>
          ))}
        </div>
      </div>
    </McpUseProvider>
  );
}
```

**Corresponding tool:**
```typescript
server.tool(
  {
    name: "create-todo",
    schema: z.object({
      title: z.string().describe("Todo title")
    })
  },
  async ({ title }) => {
    const todo = await createTodo(title);
    return text(`Created todo: ${todo.title}`);
  }
);
```

---

## Delete Action

```tsx
const handleDelete = async (id: string) => {
  if (!confirm("Are you sure you want to delete this item?")) {
    return;
  }

  try {
    await callTool("delete-todo", { id });
  } catch (error) {
    alert("Failed to delete item");
  }
};

return (
  <McpUseProvider autoSize>
    <div>
      {props.todos.map(todo => (
        <div key={todo.id} style={{ display: "flex", justifyContent: "space-between", padding: 8 }}>
          <span>{todo.title}</span>
          <button onClick={() => handleDelete(todo.id)}>Delete</button>
        </div>
      ))}
    </div>
  </McpUseProvider>
);
```

---

## Optimistic Updates

Update UI immediately, then call tool:

```tsx
import { useState, useEffect } from "react";

interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

export default function OptimisticWidget() {
  const { props, isPending, callTool } = useWidget<{ todos: Todo[] }>();
  const [todos, setTodos] = useState<Todo[]>([]);

  // Sync todos from props once loaded
  useEffect(() => {
    if (!isPending && props.todos) {
      setTodos(props.todos);
    }
  }, [isPending, props.todos]);

  const handleToggle = async (id: string) => {
    // Optimistic update
    setTodos(prev => prev.map(todo =>
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ));

    try {
      // Call tool in background
      await callTool("toggle-todo", { id });
    } catch (error) {
      // Revert on failure
      setTodos(props.todos);
      alert("Failed to update todo");
    }
  };

  if (isPending) {
    return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;
  }

  return (
    <McpUseProvider autoSize>
      <div>
        {todos.map(todo => (
          <div key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => handleToggle(todo.id)}
            />
            {todo.title}
          </div>
        ))}
      </div>
    </McpUseProvider>
  );
}
```

---

## Action Buttons

Multiple actions per item:

```tsx
const handleAction = async (action: string, id: string) => {
  try {
    await callTool(action, { id });
  } catch (error) {
    alert(`Failed to ${action}`);
  }
};

return (
  <McpUseProvider autoSize>
    <div>
      {props.items.map(item => (
        <div key={item.id} style={{ padding: 12, border: "1px solid #ddd", marginBottom: 8 }}>
          <h3>{item.title}</h3>
          <p>{item.description}</p>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => handleAction("edit-item", item.id)}>
              Edit
            </button>
            <button onClick={() => handleAction("duplicate-item", item.id)}>
              Duplicate
            </button>
            <button onClick={() => handleAction("archive-item", item.id)}>
              Archive
            </button>
            <button
              onClick={() => handleAction("delete-item", item.id)}
              style={{ color: "red" }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  </McpUseProvider>
);
```

---

## Inline Editing

```tsx
import { useState } from "react";

export default function EditableList() {
  const { props, isPending, callTool } = useWidget();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (id: string, currentValue: string) => {
    setEditingId(id);
    setEditValue(currentValue);
  };

  const saveEdit = async (id: string) => {
    try {
      await callTool("update-item", { id, title: editValue });
      setEditingId(null);
    } catch (error) {
      alert("Failed to save");
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  if (isPending) {
    return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;
  }

  return (
    <McpUseProvider autoSize>
      <div>
        {props.items.map(item => (
          <div key={item.id} style={{ padding: 8, display: "flex", gap: 8 }}>
            {editingId === item.id ? (
              <>
                <input
                  type="text"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  autoFocus
                />
                <button onClick={() => saveEdit(item.id)}>Save</button>
                <button onClick={cancelEdit}>Cancel</button>
              </>
            ) : (
              <>
                <span>{item.title}</span>
                <button onClick={() => startEdit(item.id, item.title)}>Edit</button>
              </>
            )}
          </div>
        ))}
      </div>
    </McpUseProvider>
  );
}
```

---

## Batch Actions

Select multiple items and act on them:

```tsx
import { useState } from "react";

export default function BatchActions() {
  const { props, isPending, callTool } = useWidget();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);

  const toggleSelection = (id: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedIds(newSelection);
  };

  const handleBatchAction = async (action: string) => {
    if (selectedIds.size === 0) return;

    setProcessing(true);
    try {
      await callTool(action, {
        ids: Array.from(selectedIds)
      });
      setSelectedIds(new Set());  // Clear selection
    } catch (error) {
      alert(`Failed to ${action}`);
    } finally {
      setProcessing(false);
    }
  };

  if (isPending) {
    return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;
  }

  return (
    <McpUseProvider autoSize>
      <div>
        {/* Batch action buttons */}
        {selectedIds.size > 0 && (
          <div style={{ padding: 12, backgroundColor: "#f5f5f5", marginBottom: 16 }}>
            <span>{selectedIds.size} selected</span>
            <button
              onClick={() => handleBatchAction("archive-items")}
              disabled={processing}
              style={{ marginLeft: 8 }}
            >
              Archive
            </button>
            <button
              onClick={() => handleBatchAction("delete-items")}
              disabled={processing}
              style={{ marginLeft: 8 }}
            >
              Delete
            </button>
          </div>
        )}

        {/* Item list */}
        {props.items.map(item => (
          <div key={item.id} style={{ padding: 8, display: "flex", gap: 8 }}>
            <input
              type="checkbox"
              checked={selectedIds.has(item.id)}
              onChange={() => toggleSelection(item.id)}
            />
            <span>{item.title}</span>
          </div>
        ))}
      </div>
    </McpUseProvider>
  );
}
```

**Corresponding tool:**
```typescript
server.tool(
  {
    name: "delete-items",
    schema: z.object({
      ids: z.array(z.string()).describe("Item IDs to delete")
    })
  },
  async ({ ids }) => {
    await Promise.all(ids.map(id => deleteItem(id)));
    return text(`Deleted ${ids.length} items`);
  }
);
```

---

## Handling Tool Errors

```tsx
import { useState } from "react";

const [error, setError] = useState<string | null>(null);

const handleAction = async (toolName: string, params: any) => {
  setError(null);  // Clear previous error

  try {
    await callTool(toolName, params);
  } catch (err) {
    // Display error to user
    setError(err instanceof Error ? err.message : "Action failed");
  }
};

return (
  <McpUseProvider autoSize>
    <div>
      {error && (
        <div style={{ padding: 12, backgroundColor: "#ffebee", color: "#c62828", marginBottom: 16 }}>
          {error}
        </div>
      )}

      <button onClick={() => handleAction("some-tool", { ... })}>
        Perform Action
      </button>
    </div>
  </McpUseProvider>
);
```

---

## Loading States

Show loading indicator during tool call:

```tsx
const [loadingId, setLoadingId] = useState<string | null>(null);

const handleAction = async (id: string) => {
  setLoadingId(id);
  try {
    await callTool("process-item", { id });
  } catch (error) {
    alert("Failed");
  } finally {
    setLoadingId(null);
  }
};

return (
  <McpUseProvider autoSize>
    <div>
      {props.items.map(item => (
        <div key={item.id}>
          <span>{item.title}</span>
          <button
            onClick={() => handleAction(item.id)}
            disabled={loadingId === item.id}
          >
            {loadingId === item.id ? "Processing..." : "Process"}
          </button>
        </div>
      ))}
    </div>
  </McpUseProvider>
);
```

---

## Confirmation Dialogs

```tsx
const handleDelete = async (id: string, title: string) => {
  const confirmed = confirm(`Are you sure you want to delete "${title}"?`);

  if (!confirmed) return;

  try {
    await callTool("delete-item", { id });
  } catch (error) {
    alert("Failed to delete");
  }
};
```

Or with custom dialog:

```tsx
import { useState } from "react";

const [confirmDialog, setConfirmDialog] = useState<{ id: string; title: string } | null>(null);

const handleDeleteClick = (id: string, title: string) => {
  setConfirmDialog({ id, title });
};

const handleConfirmDelete = async () => {
  if (!confirmDialog) return;

  try {
    await callTool("delete-item", { id: confirmDialog.id });
    setConfirmDialog(null);
  } catch (error) {
    alert("Failed to delete");
  }
};

return (
  <McpUseProvider autoSize>
    <div>
      {/* Items */}
      {props.items.map(item => (
        <div key={item.id}>
          <span>{item.title}</span>
          <button onClick={() => handleDeleteClick(item.id, item.title)}>
            Delete
          </button>
        </div>
      ))}

      {/* Confirmation dialog */}
      {confirmDialog && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}>
          <div style={{ backgroundColor: "white", padding: 24, borderRadius: 8 }}>
            <h3>Confirm Delete</h3>
            <p>Delete "{confirmDialog.title}"?</p>
            <button onClick={handleConfirmDelete}>Delete</button>
            <button onClick={() => setConfirmDialog(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  </McpUseProvider>
);
```

---

## Complete Example

```tsx
import { useState } from "react";
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

export const widgetMetadata: WidgetMetadata = {
  description: "Interactive todo list",
  props: z.object({
    todos: z.array(z.object({
      id: z.string(),
      title: z.string(),
      completed: z.boolean()
    }))
  }),
  exposeAsTool: false
};

export default function InteractiveTodoList() {
  const { props, isPending, callTool } = useWidget();
  const [newTodo, setNewTodo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (isPending) {
    return <McpUseProvider autoSize><div>Loading todos...</div></McpUseProvider>;
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodo.trim()) return;

    setSubmitting(true);
    try {
      await callTool("create-todo", { title: newTodo });
      setNewTodo("");
    } catch (error) {
      alert("Failed to create todo");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (id: string, completed: boolean) => {
    await callTool("toggle-todo", { id, completed: !completed });
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await callTool("delete-todo", { id });
    } catch (error) {
      alert("Failed to delete");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <McpUseProvider autoSize>
      <div style={{ padding: 20 }}>
        <h2>Todos ({props.todos.length})</h2>

        {/* Create form */}
        <form onSubmit={handleCreate} style={{ marginBottom: 16 }}>
          <input
            type="text"
            value={newTodo}
            onChange={e => setNewTodo(e.target.value)}
            placeholder="New todo..."
            disabled={submitting}
            style={{ padding: 8, width: 300, marginRight: 8 }}
          />
          <button type="submit" disabled={submitting}>
            {submitting ? "Adding..." : "Add"}
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
                padding: 8,
                borderBottom: "1px solid #eee"
              }}
            >
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => handleToggle(todo.id, todo.completed)}
              />
              <span style={{
                flex: 1,
                textDecoration: todo.completed ? "line-through" : "none",
                color: todo.completed ? "#999" : "inherit"
              }}>
                {todo.title}
              </span>
              <button
                onClick={() => handleDelete(todo.id)}
                disabled={deletingId === todo.id}
                style={{ color: "red" }}
              >
                {deletingId === todo.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          ))}
        </div>

        {props.todos.length === 0 && (
          <p style={{ color: "#999", textAlign: "center" }}>No todos yet</p>
        )}
      </div>
    </McpUseProvider>
  );
}
```

---

## Best Practices

1. **Always handle errors** - Wrap callTool in try/catch
2. **Show loading states** - Disable buttons, show spinners
3. **Provide feedback** - Success messages, error alerts
4. **Optimistic updates** - Update UI before server response for snappy UX
5. **Confirm destructive actions** - Use confirm() for deletes
6. **Clear forms on success** - Reset input after successful submission

---

## Next Steps

- **Style widgets** → [ui-guidelines.md](ui-guidelines.md)
- **Advanced patterns** → [advanced.md](advanced.md)
- **See examples** → [../patterns/common-patterns.md](../patterns/common-patterns.md)

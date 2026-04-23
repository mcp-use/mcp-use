# Model Context Annotations

Keep the AI model aware of what the user is currently seeing in your widget — without requiring explicit tool calls or storing data in developer-managed state.

Both APIs feed into a shared global registry that serializes to an indented tree string, pushed to the host via `ui/update-model-context` (MCP Apps) or `setWidgetState` (ChatGPT Apps SDK). Updates are batched via `queueMicrotask`.

---

## When to Use

| Situation | Use |
|-----------|-----|
| Annotate what the user is *seeing* right now | `<ModelContext>` or `modelContext.set()` |
| Annotate in JSX, tied to component lifecycle | `<ModelContext content="...">` |
| Annotate from an event handler or outside React | `modelContext.set(key, value)` |
| Persist structured state the model reads on future turns | `setState` from `useWidget` |

Do **not** use `<ModelContext>` as a replacement for `setState`. They serve different purposes:
- `setState` = developer-managed state (cart, selections, filters). Explicit, you control the shape.
- `ModelContext` = declarative description of what the user *sees*. Set it and forget it.

---

## `<ModelContext>` Component

Declarative, lifecycle-tied, nesting-aware. Removes itself from the tree on unmount — no cleanup needed.

```tsx
import { ModelContext, useWidget, McpUseProvider } from "mcp-use/react";

export default function DashboardWidget() {
  const { props, isPending } = useWidget<{ activeTab: string }>();
  const [hovered, setHovered] = useState<string | null>(null);

  if (isPending) return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;

  return (
    <McpUseProvider autoSize>
      {/* Root annotation — present for the full widget lifetime */}
      <ModelContext content="User is viewing the analytics dashboard">

        {/* Re-registers automatically when props.activeTab changes */}
        <ModelContext content={`Active tab: ${props.activeTab}`} />

        {/* Conditional — only present while something is hovered */}
        {hovered && (
          <ModelContext content={`Hovering over chart: ${hovered}`} />
        )}

        {/* Nesting — children become child nodes in the model's tree */}
        <ModelContext content="Metrics panel">
          <ModelContext content="Revenue chart visible" />
          <ModelContext content="User count visible" />
        </ModelContext>

        <div>{/* widget UI */}</div>
      </ModelContext>
    </McpUseProvider>
  );
}
```

The model receives an indented tree:
```
- User is viewing the analytics dashboard
  - Active tab: overview
  - Hovering over chart: Revenue Q4
  - Metrics panel
    - Revenue chart visible
    - User count visible
```

### Nesting Rules

- `<ModelContext>` at the same JSX level → siblings (flat list at that depth)
- `<ModelContext>` inside another's `children` → child node in the tree
- Self-closing `<ModelContext content="..." />` → leaf node, no children needed

---

## `modelContext` Module-Level API

Imperative, works anywhere — event handlers, plain functions, `useEffect`, outside React entirely. Entries are always root-level (no parent).

```tsx
import { modelContext } from "mcp-use/react";

// From an event handler
function onProductSelect(product: Product) {
  modelContext.set("selection", `User selected: ${product.name} ($${product.price})`);
}

function onDrawerClose() {
  modelContext.remove("selection");
}

// From useEffect (lifecycle-aware)
useEffect(() => {
  modelContext.set("page", `Viewing page ${currentPage} of ${totalPages}`);
  return () => modelContext.remove("page");
}, [currentPage, totalPages]);
```

| Method | Description |
|--------|-------------|
| `modelContext.set(key, content)` | Register or update a named entry. Same key = overwrite. |
| `modelContext.remove(key)` | Remove an entry by key. |
| `modelContext.clear()` | Remove all entries (component-based and imperative). |

**Important:** Unlike `<ModelContext>`, `modelContext.set()` entries are NOT automatically cleaned up on component unmount. Always call `.remove(key)` in cleanup logic, or use `<ModelContext>` when you need automatic lifecycle management.

---

## How the Tree is Sent to the Model

The serialized string is sent under a reserved `__model_context` key:
- **MCP Apps**: `ui/update-model-context` with `structuredContent.__model_context`
- **ChatGPT Apps SDK**: `setWidgetState` with `__model_context` merged into the state object

`__model_context` is **filtered from the developer-facing `state`** returned by `useWidget` — it never appears in your code.

Calling `setState` from `useWidget` preserves the current `__model_context` value, so user state updates never wipe annotations.

---

## Common Patterns

### Tab-switching widget

```tsx
const [tab, setTab] = useState("overview");

<ModelContext content={`User is on the ${tab} tab`}>
  <TabContent tab={tab} />
</ModelContext>
```

### Selected item (imperative)

```tsx
function onSelect(item: Item) {
  modelContext.set("selected", `Selected: ${item.name}`);
}
function onDeselect() {
  modelContext.remove("selected");
}
```

### Multi-level dashboard

```tsx
<ModelContext content="Dashboard — overview mode">
  <ModelContext content={`Showing ${period} data`} />
  <ModelContext content={`${visibleCharts.length} charts visible`} />
</ModelContext>
```

---

## Reference

- Full API reference: https://docs.mcp-use.com/typescript/server/widget-components/modelcontext
- Example server: `examples/server/ui/model-context/`

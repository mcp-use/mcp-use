# Widget Basics

Widgets are React components that provide visual UI for MCP tools. They let users browse, compare, and interact with data visually.

**Use widgets for:** Product lists, calendars, dashboards, search results, file browsers, any visual data representation

---

## When to Use Widgets

**Use a widget when:**
- ✅ Browsing or comparing multiple items
- ✅ Visual representation improves understanding (charts, images, layouts)
- ✅ Interactive selection is easier visually than through text
- ✅ User needs to see data structure at a glance

**Use plain tool (no widget) when:**
- ❌ Output is simple text or a single value
- ❌ No visual representation adds value
- ❌ Quick conversational response is sufficient

**When in doubt:** Use a widget. It makes the experience better.

---

## Minimal Widget

### 1. Create Tool with Widget Config

```typescript
// index.ts
import { MCPServer, widget, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0"
});

server.tool(
  {
    name: "show-weather",
    description: "Display weather for a city",
    schema: z.object({
      city: z.string().describe("City name")
    }),
    widget: {
      name: "weather-display",        // Must match filename: resources/weather-display.tsx
      invoking: "Fetching weather...", // Optional: shown while loading
      invoked: "Weather loaded"        // Optional: shown when complete
    }
  },
  async ({ city }) => {
    const data = await getWeather(city);

    return widget({
      props: {
        city: data.city,
        temp: data.temperature,
        conditions: data.conditions,
        icon: data.icon
      },
      output: text(`Weather in ${city}: ${data.temperature}°C, ${data.conditions}`)
    });
  }
);
```

### 2. Create Widget Component

```tsx
// resources/weather-display.tsx
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

const propsSchema = z.object({
  city: z.string(),
  temp: z.number(),
  conditions: z.string(),
  icon: z.string()
});

export const widgetMetadata: WidgetMetadata = {
  description: "Display weather information for a city",
  props: propsSchema,
  exposeAsTool: false  // ← Critical: prevents duplicate tool registration
};

const WeatherDisplay = ({ city, temp, conditions, icon }) => {
  // Framework features via hook (opt-in)
  const { isPending } = useWidget();
  
  if (isPending) return <McpUseProvider autoSize><div>Loading weather...</div></McpUseProvider>;
  
  return (
    <McpUseProvider autoSize>
      <div style={{ padding: 20 }}>
        <h2>{city}</h2>
        <img src={icon} alt={conditions} width={64} />
        <div style={{ fontSize: 48 }}>{temp}°C</div>
        <p>{conditions}</p>
      </div>
    </McpUseProvider>
  );
};

export default WeatherDisplay;
```

**Key points:**
1. Export `widgetMetadata` with props schema
2. Component receives props automatically 
3. Props are auto-typed from the Zod schema
4. Use `useWidget()` hook only for framework features (isPending, callTool, theme, etc.)
5. Set `exposeAsTool: false` to avoid duplicate registration
6. Always wrap the root in `<McpUseProvider autoSize>` for auto-sizing and theme support

---

## Widget Metadata

The `widgetMetadata` export defines your widget's contract:

```typescript
export const widgetMetadata: WidgetMetadata = {
  description: "Brief description of what this widget displays",
  props: z.object({
    // Define all props the widget expects
    id: z.string(),
    title: z.string(),
    count: z.number(),
    items: z.array(z.object({
      name: z.string(),
      value: z.number()
    }))
  }),
  exposeAsTool: false  // Always false for custom widgets
};
```

**Fields:**
- `description` - What the widget displays/does
- `props` - Zod schema defining expected props shape
- `exposeAsTool` - Set to `false` for widgets paired with custom tools

---

## useWidget() Hook

With the zero-config pattern, **props come directly into the component signature** — you don't need to destructure them from `useWidget()`. Use `useWidget()` only for framework features.

```typescript
// Props are auto-injected into your component signature
const MyWidget = ({ city, temp }) => {
  // Use useWidget() for framework features only
  const {
    isPending,       // True while tool is executing
    output,          // Tool's return value (what the model sees)
    partialToolInput, // Streaming props during generation (live preview)
    isStreaming,     // True while partialToolInput is being streamed
    callTool,        // Call other MCP tools
    setState,        // Update persistent widget state
    state,           // Current widget state
    theme,           // "light" | "dark"
  } = useWidget();
};
```

### isPending

**CRITICAL:** Widgets render **before** the tool completes execution. `isPending` tells you whether the tool is still running.

**Widget Lifecycle:**
1. Widget mounts immediately when tool is called → `isPending = true`, props are `{}`
2. (Optional) LLM streams tool arguments → `isStreaming = true`, `partialToolInput` updates
3. Tool executes and returns → `isPending = false`, props contain final data

```typescript
const Widget = ({ city, temp }) => {
  const { isPending } = useWidget();

  if (isPending) {
    return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;
  }

  // Now safe to use props
  return (
    <McpUseProvider autoSize>
      <div>{city} — {temp}°C</div>
    </McpUseProvider>
  );
};
```

### output

The structured data your server returned to the **model** (not the widget). This is the result of `return object({...})` in your tool handler — what appears in the chat.

```typescript
const Widget = ({ products }) => {
  const { output } = useWidget<unknown, { count: number; category: string }>();

  return (
    <McpUseProvider autoSize>
      <div>
        {/* output is what was returned to the model */}
        <p>Showing {output?.count} {output?.category} products</p>
        <ul>{products.map(p => <li key={p.id}>{p.name}</li>)}</ul>
      </div>
    </McpUseProvider>
  );
};
```

### partialToolInput + isStreaming

When the LLM streams its tool arguments (supported in MCP Apps hosts), you can show a live preview as the user types:

```typescript
const CodeWidget = ({ code, language }) => {
  const { isPending, isStreaming, partialToolInput } = useWidget();

  // Show partial content during streaming, then final props when complete
  const displayCode = isStreaming && partialToolInput?.code != null
    ? partialToolInput.code
    : code ?? "";

  return (
    <McpUseProvider autoSize>
      <pre data-language={language}>{displayCode || (isPending ? "Waiting..." : "")}</pre>
    </McpUseProvider>
  );
};
```

**Handling isPending patterns:**

```typescript
// ✅ Pattern 1: Early return (recommended)
if (isPending) return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;
return <McpUseProvider autoSize><div>{city}</div></McpUseProvider>;

// ✅ Pattern 2: Conditional rendering
return (
  <McpUseProvider autoSize>
    {isPending ? <div>Loading...</div> : <div>{city}</div>}
  </McpUseProvider>
);
```

---

## McpUseProvider

**Required wrapper** for all widgets. Provides context and handles iframe sizing.

```typescript
import { McpUseProvider, useWidget } from "mcp-use/react";

const MyWidget = ({ city, temp }) => {
  const { isPending } = useWidget();

  if (isPending) {
    return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;
  }

  return (
    <McpUseProvider autoSize>
      <div>
        {city} — {temp}°C
      </div>
    </McpUseProvider>
  );
};

export default MyWidget;
```
```

**Props:**
- `autoSize={true}` - Automatically resize iframe to content (recommended)
- `autoSize={false}` - Fixed height, widget handles scrolling

**Must wrap:**
- ✅ Every return path (including loading states)
- ✅ Root element of component

---

## Props Handling Patterns

With zero-config prop injection, props come directly into your component signature — auto-typed from your `widgetMetadata.props` schema.

### Simple Props
```typescript
export const widgetMetadata: WidgetMetadata = {
  props: z.object({
    message: z.string(),
    count: z.number()
  }),
  exposeAsTool: false
};

// Props are auto-injected and auto-typed!
const SimpleWidget = ({ message, count }) => {
  const { isPending } = useWidget();

  if (isPending) return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;

  return (
    <McpUseProvider autoSize>
      <div>
        <p>{message}</p>
        <p>Count: {count}</p>
      </div>
    </McpUseProvider>
  );
};

export default SimpleWidget;
```

### Array Props
```typescript
export const widgetMetadata: WidgetMetadata = {
  props: z.object({
    items: z.array(z.object({
      id: z.string(),
      name: z.string()
    }))
  }),
  exposeAsTool: false
};

const ListWidget = ({ items }) => {
  const { isPending } = useWidget();

  if (isPending) return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;

  return (
    <McpUseProvider autoSize>
      <ul>
        {items.map(item => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </McpUseProvider>
  );
};

export default ListWidget;
```

### Nested Props
```typescript
export const widgetMetadata: WidgetMetadata = {
  props: z.object({
    user: z.object({
      name: z.string(),
      profile: z.object({
        bio: z.string(),
        avatar: z.string()
      })
    })
  }),
  exposeAsTool: false
};

const ProfileWidget = ({ user }) => {
  const { isPending } = useWidget();

  if (isPending) return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;

  return (
    <McpUseProvider autoSize>
      <div>
        <img src={user.profile.avatar} alt={user.name} />
        <h2>{user.name}</h2>
        <p>{user.profile.bio}</p>
      </div>
    </McpUseProvider>
  );
};

export default ProfileWidget;
```

### Optional Props
```typescript
export const widgetMetadata: WidgetMetadata = {
  props: z.object({
    title: z.string(),
    subtitle: z.string().optional(),  // May be undefined
    items: z.array(z.string())
  }),
  exposeAsTool: false
};

const FlexibleWidget = ({ title, subtitle, items }) => {
  const { isPending } = useWidget();

  if (isPending) return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;

  return (
    <McpUseProvider autoSize>
      <div>
        <h1>{title}</h1>
        {subtitle && <h2>{subtitle}</h2>}
        <ul>
          {items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      </div>
    </McpUseProvider>
  );
};

export default FlexibleWidget;
```
```

---

## File Location

Widgets live in `resources/` directory:

```
my-server/
├── index.ts              # Server code
├── resources/
│   ├── weather-display.tsx    # Widget component
│   ├── product-list.tsx
│   └── calendar-view.tsx
└── package.json
```

**Naming convention:**
- Use kebab-case for widget names
- Tool config: `widget: { name: "weather-display" }`
- File: `resources/weather-display.tsx`

---

## TypeScript Types

Props are **automatically typed** from your `widgetMetadata.props` Zod schema when using `mcp-use dev`. No manual type annotations needed!

⚠️ **CRITICAL:** Always define your Zod schema in a separate constant before `widgetMetadata`. Never infer types from `widgetMetadata.props` inline.

```typescript
import { z } from "zod";
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";

const propsSchema = z.object({
  city: z.string(),
  temp: z.number(),
  conditions: z.string()
});

export const widgetMetadata: WidgetMetadata = {
  description: "Display weather",
  props: propsSchema,
  exposeAsTool: false
};

// Props auto-typed from schema — city is string, temp is number!
const WeatherWidget = ({ city, temp, conditions }) => {
  const { isPending } = useWidget();

  if (isPending) return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;

  return (
    <McpUseProvider autoSize>
      <div>
        <h2>{city}</h2>         {/* ✓ TypeScript knows this is string */}
        <p>{temp}°C</p>         {/* ✓ TypeScript knows this is number */}
        <p>{conditions}</p>
      </div>
    </McpUseProvider>
  );
};

export default WeatherWidget;
```

**How it works:** Running `mcp-use dev` generates `.mcp-use/<widget>/types.ts` from your schema automatically. TypeScript picks it up via your `tsconfig.json`'s `include` path.
```

---

## Common Mistakes

### ❌ Missing isPending Check
```typescript
// ❌ Bad - props undefined during loading (title will be undefined/error)
const BadWidget = ({ title }) => {
  return (
    <McpUseProvider autoSize>
      <div>{title}</div>  {/* title is undefined while isPending! */}
    </McpUseProvider>
  );
};

// ✅ Good
const GoodWidget = ({ title }) => {
  const { isPending } = useWidget();

  if (isPending) return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;

  return (
    <McpUseProvider autoSize>
      <div>{title}</div>
    </McpUseProvider>
  );
};
```

### ❌ Missing McpUseProvider
```typescript
// ❌ Bad - Missing provider (won't render correctly)
const BadWidget = ({ title }) => {
  const { isPending } = useWidget();

  if (isPending) return <div>Loading...</div>;

  return <div>{title}</div>;
};

// ✅ Good
const GoodWidget = ({ title }) => {
  const { isPending } = useWidget();

  if (isPending) return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;

  return (
    <McpUseProvider autoSize>
      <div>{title}</div>
    </McpUseProvider>
  );
};
```

### ❌ Missing exposeAsTool: false
```typescript
// ❌ Bad - Creates duplicate tool
export const widgetMetadata: WidgetMetadata = {
  description: "...",
  props: z.object({ ... })
  // Missing exposeAsTool: false
};

// ✅ Good
export const widgetMetadata: WidgetMetadata = {
  description: "...",
  props: z.object({ ... }),
  exposeAsTool: false  // Prevents duplicate
};
```

### ❌ Inline Schema (Types Won't Infer)
```typescript
// ❌ Bad - Inline schema means TypeScript loses type information
export const widgetMetadata: WidgetMetadata = {
  description: "...",
  props: z.object({
    title: z.string(),
    count: z.number()
  })  // Inline schema definition — title/count won't be typed in component
};

// ✅ Good - Extract schema first so auto-injection is properly typed
const propsSchema = z.object({
  title: z.string(),
  count: z.number()
});

export const widgetMetadata: WidgetMetadata = {
  description: "...",
  props: propsSchema  // Reference the schema variable
};

// Now title and count are fully typed in the component signature!
const GoodWidget = ({ title, count }) => {
  const { isPending } = useWidget();
  if (isPending) return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;
  return <McpUseProvider autoSize><div>{title}: {count}</div></McpUseProvider>;
};
```

**Why this happens:** The `WidgetMetadata` type is generic, so TypeScript can't preserve the specific Zod schema type when defined inline. Always extract your schema to a separate constant before using it in `widgetMetadata`.

---

## Testing Widgets

Use the inspector to test widgets during development:

1. Start dev server: `npm run dev`
2. Open inspector: `http://localhost:3000/inspector`
3. Click "List Tools" → Find your tool
4. Click "Call Tool" → Enter test input
5. Widget renders in inspector

**Quick iteration:**
- Change widget code → Auto-reload
- Adjust props schema → Update tool call input
- Test edge cases (empty lists, missing optional props)

---

## Complete Example

```typescript
// index.ts
import { MCPServer, widget, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "product-server",
  version: "1.0.0"
});

server.tool(
  {
    name: "search-products",
    description: "Search products by keyword",
    schema: z.object({
      query: z.string().describe("Search query")
    }),
    widget: {
      name: "product-list",
      invoking: "Searching products...",
      invoked: "Products loaded"
    }
  },
  async ({ query }) => {
    const products = await searchProducts(query);

    return widget({
      props: {
        products,
        query,
        totalCount: products.length
      },
      output: text(`Found ${products.length} products matching "${query}"`)
    });
  }
);

server.listen();
```

```tsx
// resources/product-list.tsx
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

export const widgetMetadata: WidgetMetadata = {
  description: "Display product search results",
  props: z.object({
    products: z.array(z.object({
      id: z.string(),
      name: z.string(),
      price: z.number(),
      image: z.string()
    })),
    query: z.string(),
    totalCount: z.number()
  }),
  exposeAsTool: false
};

export default function ProductList() {
  const { props, isPending } = useWidget();

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 20 }}>Loading products...</div>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider autoSize>
      <div style={{ padding: 20 }}>
        <h2>Search: "{props.query}"</h2>
        <p>Found {props.totalCount} products</p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
          {props.products.map(product => (
            <div key={product.id} style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
              <img src={product.image} alt={product.name} style={{ width: "100%", height: 150, objectFit: "cover" }} />
              <h3 style={{ fontSize: 16, margin: "8px 0" }}>{product.name}</h3>
              <p style={{ fontSize: 18, fontWeight: "bold" }}>${product.price}</p>
            </div>
          ))}
        </div>
      </div>
    </McpUseProvider>
  );
}
```

---

## Next Steps

- **Manage widget state** → [state.md](state.md)
- **Add interactivity** → [interactivity.md](interactivity.md)
- **Style with themes** → [ui-guidelines.md](ui-guidelines.md)
- **Advanced patterns** → [advanced.md](advanced.md)

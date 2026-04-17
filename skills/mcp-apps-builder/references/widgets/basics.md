# Widget basics (inline JSX)

Widgets are **plain React components**. The server returns them as **JSX** from `server.tool()` handlers. The mcp-use JSX runtime and bundler register MCP Apps + ChatGPT metadata — no required `resources/` folder, no `widget: { name }`, no `widgetMetadata` export for the primary pattern.

**Use widgets for:** lists, dashboards, search results, comparisons, anything where visual UI helps.

---

## Minimal pattern

### 1. Server file

Use **`/** @jsxImportSource mcp-use/jsx */`** on the file that returns JSX (often `index.tsx`).

```tsx
/** @jsxImportSource mcp-use/jsx */
import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";
import WeatherCard from "./components/WeatherCard";

const server = new MCPServer({ name: "my-server", version: "1.0.0" });

server.tool(
  {
    name: "show-weather",
    description: "Display weather for a city",
    schema: z.object({ city: z.string().describe("City name") }),
  },
  async ({ city }) => {
    const data = await getWeather(city);
    return (
      <WeatherCard
        city={data.city}
        temp={data.temperature}
        conditions={data.conditions}
        icon={data.icon}
        _output={text(
          `Weather in ${city}: ${data.temperature}°C, ${data.conditions}`
        )}
        _invoking="Fetching weather..."
        _invoked="Weather loaded"
        _csp={{ connectDomains: ["https://api.weather.com"] }}
      />
    );
  }
);

await server.listen();
```

- **Regular props** → `structuredContent` → `useWidget().props` (model does not see them unless echoed in `_output`).
- **`_output`** → model-visible content (use `text()`, `object()`, etc.).
- **`_invoking` / `_invoked`** → host status strings.
- **`_csp`**, **`_prefersBorder`**, **`_meta`**, etc. → protocol metadata.

### 2. Component

Put UI anywhere (e.g. `components/WeatherCard.tsx`). **Do not** use `useWidget` inside the server file — only inside components that run in the widget iframe.

```tsx
import { McpUseProvider, useWidget } from "mcp-use/react";

export type WeatherCardProps = {
  city: string;
  temp: number;
  conditions: string;
  icon: string;
};

export default function WeatherCard({
  city,
  temp,
  conditions,
  icon,
}: WeatherCardProps) {
  const { isPending } = useWidget();

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div>Loading weather...</div>
      </McpUseProvider>
    );
  }

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
}
```

### 3. Static metadata on the component (optional)

For CSP / border defaults that belong to the component, use **`defineWidget`** or **`Component.config`** (`mcp-use/react`). Per-call overrides still use `_csp` / `_prefersBorder` on the JSX in the server file.

---

## `useWidget()`

Same as before: **`props`**, **`isPending`**, **`metadata`**, **`setState`**, theme, **`callTool`** (or prefer **`useCallTool`** from `mcp-use/react`).

**Always guard `isPending`** before reading `props`.

---

## `McpUseProvider`

Wrap widget UI (including loading states). Use **`autoSize`** unless you have a fixed-height layout.

---

## Conditional clients

```tsx
async (params, ctx) => {
  if (ctx.client.supportsApps()) {
    return <WeatherCard {...} _output={text("...")} />;
  }
  return text("Text-only clients see this.");
};
```

---

## File layout

No enforced `resources/` folder. Typical:

```
my-server/
├── components/
│   └── WeatherCard.tsx
├── index.tsx
└── package.json
```

---

## Common mistakes

- Returning JSX **without** `@jsxImportSource mcp-use/jsx` on that file.
- Reading **`props`** when **`isPending`** is true.
- Putting **`useWidget`** in the server module (it runs only in the iframe bundle).
- Using **`exposeAsTool`** / **`widgetMetadata`** for new code — see migration docs in the main repo if you need legacy patterns.

---

## Next steps

- **State** → [state.md](state.md)
- **Interactivity / `useCallTool`** → [interactivity.md](interactivity.md)
- **Theming** → [ui-guidelines.md](ui-guidelines.md)
- **Advanced** → [advanced.md](advanced.md)

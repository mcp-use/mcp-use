---
name: chatgpt-app-builder
description: Build ChatGPT apps with interactive widgets using mcp-use and OpenAI Apps SDK. Use when creating ChatGPT apps, building MCP servers with widgets, defining React widgets, working with Apps SDK, or when user mentions ChatGPT widgets, mcp-use widgets, or Apps SDK development.
---

# ChatGPT App Builder

Build production-ready ChatGPT apps with interactive widgets using mcp-use. Zero-config widget development with automatic registration and built-in React hooks.

## Quick Start

```bash
npx create-mcp-use-app my-chatgpt-app --template mcp-apps
cd my-chatgpt-app
npm install && npm run dev
```

Project structure:
```
my-chatgpt-app/
├── resources/              # React widgets (auto-registered!)
│   ├── weather-display.tsx # Example widget
│   └── product-card.tsx    # Another widget
├── public/                 # Static assets
│   └── images/
├── index.ts               # MCP server entry
├── package.json
└── tsconfig.json
```

## Why mcp-use for ChatGPT Apps?

Traditional OpenAI Apps SDK requires significant manual setup:
- Separate project structure (server/ and web/ folders)
- Manual esbuild/webpack configuration
- Custom useWidgetState hook implementation
- Manual React mounting code
- Manual CSP configuration
- Manual widget registration

**mcp-use simplifies everything:**
- Single command setup
- Drop widgets in `resources/` folder - auto-registered
- Built-in `useWidget()` hook with state, props, tool calls
- Automatic bundling with hot reload
- Automatic CSP configuration
- Built-in Inspector for testing
- Dual-protocol support (works with ChatGPT AND MCP Apps clients)

## MCP Apps vs ChatGPT Apps SDK

| Protocol | Use Case | Compatibility | Status |
|----------|----------|---------------|--------|
| **MCP Apps** (`type: "mcpApps"`) | Maximum compatibility | ChatGPT + MCP Apps clients | **Recommended** |
| **ChatGPT Apps SDK** (`type: "appsSdk"`) | ChatGPT-only features | ChatGPT only | Supported |

**Why MCP Apps?** It's the official standard (SEP-1865) for interactive widgets:
- **Universal**: Works with ChatGPT, Claude Desktop, Goose, and all MCP Apps clients
- **Future-proof**: Based on open specification
- **Zero config**: With `type: "mcpApps"`, mcp-use generates metadata for BOTH protocols automatically

## Creating Widgets

### Simple Widget (Single File)

Create `resources/weather-display.tsx`:

```tsx
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

export const widgetMetadata: WidgetMetadata = {
  description: "Display current weather for a city",
  props: z.object({
    city: z.string().describe("City name"),
    temperature: z.number().describe("Temperature in Celsius"),
    conditions: z.string().describe("Weather conditions"),
    humidity: z.number().describe("Humidity percentage"),
  }),
};

const WeatherDisplay: React.FC = () => {
  const { props, isPending } = useWidget();

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div className="animate-pulse p-4">Loading weather...</div>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider autoSize>
      <div className="weather-card p-4 rounded-lg shadow">
        <h2 className="text-2xl font-bold">{props.city}</h2>
        <div className="temp text-4xl">{props.temperature}°C</div>
        <p className="conditions">{props.conditions}</p>
        <p className="humidity">Humidity: {props.humidity}%</p>
      </div>
    </McpUseProvider>
  );
};

export default WeatherDisplay;
```

Widget is automatically:
- Registered as MCP tool `weather-display`
- Registered as MCP resource `ui://widget/weather-display.html`
- Bundled for Apps SDK compatibility

### Complex Widget (Folder Structure)

For widgets with multiple components:

```
resources/
└── product-search/
    ├── widget.tsx          # Entry point (required name)
    ├── components/
    │   ├── ProductCard.tsx
    │   └── FilterBar.tsx
    ├── hooks/
    │   └── useFilter.ts
    └── types.ts
```

Entry point must be named `widget.tsx` and export `widgetMetadata` + default component.

## Widget Metadata

```typescript
export const widgetMetadata: WidgetMetadata = {
  // Required: Human-readable description
  description: "Display weather information",

  // Required: Zod schema for widget props
  props: z.object({
    city: z.string().describe("City name"),
    temperature: z.number(),
  }),

  // Optional: Disable automatic tool registration
  exposeAsTool: true, // default

  // Optional: Unified metadata (works for BOTH ChatGPT and MCP Apps)
  metadata: {
    csp: {
      connectDomains: ["https://api.weather.com"],
      resourceDomains: ["https://cdn.weather.com"],
    },
    prefersBorder: true,
    autoResize: true,
    widgetDescription: "Interactive weather display",
  },
};
```

**Key fields:**
- `description`: Used for tool and resource descriptions
- `props`: Zod schema defines widget input parameters
- `exposeAsTool`: Set to `false` if only using widget via custom tools
- `metadata`: Unified configuration for both protocols (recommended)

## Content Security Policy (CSP)

Control external resources your widget can access:

```typescript
export const widgetMetadata: WidgetMetadata = {
  description: "Weather widget",
  props: z.object({ city: z.string() }),
  metadata: {
    csp: {
      // APIs to call (fetch, WebSocket, XMLHttpRequest)
      connectDomains: ["https://api.weather.com", "https://backup.weather.com"],
      // Static assets (images, fonts, stylesheets)
      resourceDomains: ["https://cdn.weather.com"],
      // External iframes
      frameDomains: ["https://embed.weather.com"],
      // Script directives (use carefully!)
      scriptDirectives: ["'unsafe-inline'"],
    },
  },
};
```

**Security tips:**
- Specify exact domains: `https://api.weather.com`
- Avoid wildcards in production
- Never use `'unsafe-eval'` unless necessary

For detailed CSP configuration and legacy format, see [references/csp-and-metadata.md](references/csp-and-metadata.md).

## useWidget Hook

```tsx
const {
  props,              // Widget input from tool (empty {} while pending)
  isPending,          // True while tool still executing
  state,              // Persistent widget state
  setState,           // Update persistent state
  theme,              // 'light' | 'dark' from host
  callTool,           // Call other MCP tools
  displayMode,        // 'inline' | 'pip' | 'fullscreen'
  requestDisplayMode, // Request display mode change
  output,             // Additional tool output
} = useWidget<MyPropsType, MyOutputType>();
```

### Props and Loading States

**Critical:** Widgets render BEFORE tool execution completes. Always handle `isPending`:

```tsx
const { props, isPending } = useWidget<WeatherProps>();

// Pattern 1: Early return
if (isPending) {
  return <div>Loading...</div>;
}
// Now props are safe to use

// Pattern 2: Conditional rendering
return (
  <div>
    {isPending ? <LoadingSpinner /> : <div>{props.city}</div>}
  </div>
);

// Pattern 3: Optional chaining (partial UI)
return (
  <div>
    <h1>{props.city ?? "Loading..."}</h1>
  </div>
);
```

### Widget State

Persist data across widget interactions:

```tsx
const { state, setState } = useWidget();

// Save state (persists in ChatGPT localStorage)
const addFavorite = async (city: string) => {
  await setState({
    favorites: [...(state?.favorites || []), city],
  });
};

// Update with function
await setState((prev) => ({
  ...prev,
  count: (prev?.count || 0) + 1,
}));
```

### Calling MCP Tools

Widgets can call other tools:

```tsx
const { callTool } = useWidget();

const refreshData = async () => {
  try {
    const result = await callTool("get-weather", { city: "Tokyo" });
    console.log("Result:", result.content);
  } catch (error) {
    console.error("Tool call failed:", error);
  }
};
```

### Display Mode Control

```tsx
const { displayMode, requestDisplayMode } = useWidget();

const goFullscreen = async () => {
  await requestDisplayMode("fullscreen");
};

// Current mode: 'inline' | 'pip' | 'fullscreen'
console.log(displayMode);
```

## Custom Tools with Widgets

Create tools that return widgets:

```typescript
import { MCPServer, widget, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "weather-app",
  version: "1.0.0",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
});

server.tool(
  {
    name: "get-weather",
    description: "Get current weather for a city",
    schema: z.object({
      city: z.string().describe("City name"),
    }),
    // Widget config (registration-time metadata)
    widget: {
      name: "weather-display", // Must match widget in resources/
      invoking: "Fetching weather...",
      invoked: "Weather data loaded",
    },
  },
  async ({ city }) => {
    const data = await fetchWeatherAPI(city);

    return widget({
      props: {
        city,
        temperature: data.temp,
        conditions: data.conditions,
        humidity: data.humidity,
      },
      output: text(`Weather in ${city}: ${data.temp}°C`),
      message: `Current weather for ${city}`,
    });
  }
);

server.listen();
```

**Key points:**
- `baseUrl` in server config enables proper asset loading
- `widget: { name, invoking, invoked }` on tool definition
- `widget({ props, output })` helper returns runtime data
- `props` passed to widget, `output` shown to model

## Static Assets

Use `public/` folder for images, fonts:

```
my-app/
├── resources/
├── public/
│   ├── images/
│   │   ├── logo.svg
│   │   └── banner.png
│   └── fonts/
└── index.ts
```

Using assets in widgets:

```tsx
import { Image } from "mcp-use/react";

function MyWidget() {
  return (
    <div>
      {/* Paths relative to public/ folder */}
      <Image src="/images/logo.svg" alt="Logo" />
      <img src={window.__getFile?.("images/banner.png")} alt="Banner" />
    </div>
  );
}
```

## Components

### McpUseProvider

Unified provider combining all common setup:

```tsx
import { McpUseProvider } from "mcp-use/react";

function MyWidget() {
  return (
    <McpUseProvider
      autoSize      // Auto-resize widget
      viewControls  // Add debug/fullscreen buttons
      debug         // Show debug info
    >
      <div>Widget content</div>
    </McpUseProvider>
  );
}
```

### Image Component

Handles both data URLs and public paths:

```tsx
import { Image } from "mcp-use/react";

<Image src="/images/photo.jpg" alt="Photo" />
<Image src="data:image/png;base64,..." alt="Data URL" />
```

### ErrorBoundary

```tsx
import { ErrorBoundary } from "mcp-use/react";

<ErrorBoundary
  fallback={<div>Something went wrong</div>}
  onError={(error) => console.error(error)}
>
  <MyComponent />
</ErrorBoundary>
```

For full component API, see [references/components-api.md](references/components-api.md).

## Testing

### Using the Inspector

1. Start development: `npm run dev`
2. Open `http://localhost:3000/inspector`
3. Click Tools tab → Find your widget → Enter parameters → Execute
4. Debug with browser console, RPC logs, state inspection

### Testing in ChatGPT

1. **Enable Developer Mode:** Settings → Connectors → Advanced → Developer mode
2. **Add your server:** Connectors tab → Add remote MCP server URL
3. **Test:** Select Developer Mode from Plus menu → Choose connector → Use tools

**Prompting tips:**
- Be explicit: "Use the weather-app connector's get-weather tool..."
- Disallow alternatives: "Do not use built-in tools, only use my connector"
- Specify input: "Call get-weather with { city: 'Tokyo' }"

**Dual-protocol note:** With `type: "mcpApps"`, widgets work in both ChatGPT and MCP Apps clients without code changes.

## Best Practices

### Schema Design

```typescript
// Good - descriptive
const schema = z.object({
  city: z.string().describe("City name (e.g., Tokyo, Paris)"),
  temperature: z.number().min(-50).max(60).describe("Temp in Celsius"),
});

// Bad - no descriptions
const schema = z.object({
  city: z.string(),
  temp: z.number(),
});
```

### Theme Support

```tsx
const { theme } = useWidget();
const bgColor = theme === "dark" ? "bg-gray-900" : "bg-white";
const textColor = theme === "dark" ? "text-white" : "text-gray-900";
```

### Loading States

Always check `isPending` first:

```tsx
const { props, isPending } = useWidget<MyProps>();

if (isPending) return <LoadingSpinner />;
return <div>{props.field}</div>;
```

### Widget Focus

Keep widgets focused on one thing:

```typescript
// Good: Single purpose
export const widgetMetadata: WidgetMetadata = {
  description: "Display weather for a city",
  props: z.object({ city: z.string() }),
};

// Bad: Too many responsibilities
export const widgetMetadata: WidgetMetadata = {
  description: "Weather, forecast, map, news, and more",
  props: z.object({ /* many fields */ }),
};
```

### Error Handling

```tsx
const { callTool } = useWidget();

const fetchData = async () => {
  try {
    const result = await callTool("fetch-data", { id: "123" });
    if (result.isError) {
      console.error("Tool returned error");
    }
  } catch (error) {
    console.error("Tool call failed:", error);
  }
};
```

## Configuration

### Production Setup

```typescript
const server = new MCPServer({
  name: "my-app",
  version: "1.0.0",
  baseUrl: process.env.MCP_URL || "https://myserver.com",
});
```

### Environment Variables

```env
MCP_URL=https://myserver.com
MCP_SERVER_URL=https://myserver.com/api
CSP_URLS=https://cdn.example.com,https://api.example.com
```

## Deployment

```bash
npx mcp-use login
npm run deploy
```

Build for production:
```bash
npm run build
npm start
```

## Troubleshooting

### Widget Not Appearing

- Ensure `.tsx` extension
- Export `widgetMetadata` object
- Export default React component
- Check server logs for errors
- Verify widget name matches file/folder name

### Props Not Received

- Check `isPending` first (props empty while pending)
- Use `useWidget()` hook (not React props)
- Verify `widgetMetadata.props` is valid Zod schema
- Check tool parameters match schema

### CSP Errors

- Set `baseUrl` in server config
- Add domains to CSP via `metadata.csp`
- Use HTTPS for all resources
- Check browser console for CSP violations

### Protocol Compatibility

- Use `type: "mcpApps"` for dual-protocol support
- Set `baseUrl` correctly in server config
- Use `metadata` (camelCase) not `appsSdkMetadata` for dual-protocol
- Test in Inspector which supports both protocols

## Quick Reference

**Commands:**
- `npx create-mcp-use-app my-app --template mcp-apps` - Bootstrap
- `npm run dev` - Development with hot reload
- `npm run build` - Build for production
- `npm start` - Run production server
- `npm run deploy` - Deploy to mcp-use Cloud

**Widget structure:**
- `resources/widget-name.tsx` - Single file widget
- `resources/widget-name/widget.tsx` - Folder-based widget entry
- `public/` - Static assets

**Widget metadata:**
- `description` - Widget description (required)
- `props` - Zod schema for input (required)
- `exposeAsTool` - Auto-register as tool (default: true)
- `metadata` - Unified config (dual-protocol)
- `metadata.csp` - Content Security Policy

**useWidget returns:**
- `props` - Widget input parameters
- `isPending` - Loading state flag
- `state, setState` - Persistent state
- `callTool` - Call other tools
- `theme` - Current theme (light/dark)
- `displayMode, requestDisplayMode` - Display control

## References

- [Widget Patterns](references/widget-patterns.md) - Complex widgets, data fetching, state, theming examples
- [CSP and Metadata](references/csp-and-metadata.md) - Detailed CSP, legacy format, migration guide
- [Components API](references/components-api.md) - Full McpUseProvider, Image, ErrorBoundary API

## Learn More

- Documentation: https://docs.mcp-use.com
- MCP Apps Standard: https://docs.mcp-use.com/typescript/server/mcp-apps
- Widget Guide: https://docs.mcp-use.com/typescript/server/ui-widgets
- ChatGPT Apps Flow: https://docs.mcp-use.com/guides/chatgpt-apps-flow
- Inspector Debugging: https://docs.mcp-use.com/inspector/debugging-chatgpt-apps
- GitHub: https://github.com/mcp-use/mcp-use

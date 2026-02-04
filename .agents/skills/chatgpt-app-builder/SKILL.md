---
name: chatgpt-app-builder
description: Build ChatGPT apps with interactive widgets using mcp-use and OpenAI Apps SDK. Use when creating ChatGPT apps, building MCP servers with widgets, defining React widgets, working with Apps SDK, or when user mentions ChatGPT widgets, mcp-use widgets, or Apps SDK development.
---

# ChatGPT App Builder

Build production-ready ChatGPT apps with interactive widgets using the mcp-use framework and OpenAI Apps SDK. This skill provides zero-config widget development with automatic registration and built-in React hooks.

## Quick Start

**Always bootstrap with the MCP Apps template:**

```bash
npx create-mcp-use-app my-chatgpt-app --template mcp-apps
cd my-chatgpt-app
yarn install
yarn dev
```

This creates a project structure:

```
my-chatgpt-app/
├── resources/              # React widgets (auto-registered!)
│   ├── display-weather.tsx # Example widget
│   └── product-card.tsx    # Another widget
├── public/                 # Static assets
│   └── images/
├── index.ts               # MCP server entry
├── package.json
├── tsconfig.json
└── README.md
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

mcp-use supports multiple widget protocols, giving you maximum compatibility:

| Protocol                                 | Use Case               | Compatibility                 | Status          |
| ---------------------------------------- | ---------------------- | ----------------------------- | --------------- |
| **MCP Apps** (`type: "mcpApps"`)         | Maximum compatibility  | ChatGPT + MCP Apps clients | **Recommended** |
| **ChatGPT Apps SDK** (`type: "appsSdk"`) | ChatGPT-only features  | ChatGPT only               | Supported       |
| **MCP-UI**                               | Simple, static content | MCP clients only           | Specialized     |

### Why MCP Apps?

MCP Apps is the **official standard** (SEP-1865) for interactive widgets in the Model Context Protocol:

- **Universal**: Works with ChatGPT, Claude Desktop, Goose, and all MCP Apps clients
- **Future-proof**: Based on open specification, ensuring long-term compatibility
- **Secure**: Double-iframe sandbox with granular CSP control
- **Zero config**: With `type: "mcpApps"`, mcp-use automatically generates metadata for BOTH protocols

**Key Point**: When you use `type: "mcpApps"` in your server configuration, your widgets automatically work with both ChatGPT (Apps SDK protocol) and MCP Apps clients. You write the widget once, and mcp-use handles the protocol translation.

## Creating Widgets

### Simple Widget (Single File)

Create `resources/weather-display.tsx`:

```tsx
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

// Define widget metadata
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

  // Always handle loading state first
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

That's it! The widget is automatically:

- Registered as MCP tool `weather-display`
- Registered as MCP resource `ui://widget/weather-display.html`
- Bundled for Apps SDK compatibility
- Ready to use in ChatGPT

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
    ├── types.ts
    └── constants.ts
```

**Entry point (`widget.tsx`):**

```tsx
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";
import { ProductCard } from "./components/ProductCard";
import { FilterBar } from "./components/FilterBar";

export const widgetMetadata: WidgetMetadata = {
  description: "Display product search results with filtering",
  props: z.object({
    products: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        price: z.number(),
        image: z.string(),
      })
    ),
    query: z.string(),
  }),
};

const ProductSearch: React.FC = () => {
  const { props, isPending, state, setState } = useWidget();

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div>Loading...</div>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider autoSize>
      <div>
        <h1>Search: {props.query}</h1>
        <FilterBar onFilter={(filters) => setState({ filters })} />
        <div className="grid grid-cols-3 gap-4">
          {props.products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </McpUseProvider>
  );
};

export default ProductSearch;
```

## Widget Metadata

Required metadata for automatic registration:

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

**Important:**

- `description`: Used for tool and resource descriptions
- `props`: Zod schema defines widget input parameters
- `exposeAsTool`: Set to `false` if only using widget via custom tools
- `metadata`: Unified configuration that works for both protocols (recommended)

## Content Security Policy (CSP)

Control what external resources your widget can access using CSP configuration:

```typescript
export const widgetMetadata: WidgetMetadata = {
  description: "Weather widget",
  props: z.object({ city: z.string() }),
  metadata: {
    csp: {
      // APIs your widget needs to call
      connectDomains: ["https://api.weather.com", "https://weather-backup.com"],

      // Static assets (images, fonts, stylesheets)
      resourceDomains: ["https://cdn.weather.com"],

      // External content to embed in iframes
      frameDomains: ["https://embed.weather.com"],

      // Script CSP directives (use carefully!)
      scriptDirectives: ["'unsafe-inline'"],
    },
  },
};
```

**CSP Field Reference:**

- **`connectDomains`**: APIs to call via fetch, WebSocket, XMLHttpRequest
- **`resourceDomains`**: Load images, fonts, stylesheets, videos
- **`frameDomains`**: Embed external content in iframes
- **`scriptDirectives`**: Script-src CSP directives (avoid `'unsafe-eval'` in production)

**Security Best Practices:**

- Specify exact domains: `https://api.weather.com`
- Avoid wildcards: `https://*.weather.com` (less secure)
- Never use `'unsafe-eval'` unless absolutely necessary
- Test CSP in development before deploying

## Metadata Configuration Options

### Modern Unified Approach (Recommended)

Use the `metadata` field for dual-protocol support:

```typescript
export const widgetMetadata: WidgetMetadata = {
  description: "Weather widget",
  props: propSchema,
  metadata: {
    // Works for BOTH MCP Apps AND ChatGPT
    csp: {
      connectDomains: ["https://api.weather.com"],
      resourceDomains: ["https://cdn.weather.com"],
    },
    prefersBorder: true,
    autoResize: true,
    widgetDescription: "Displays current weather",
  },
};
```

### Legacy Apps SDK Approach (Deprecated)

The old ChatGPT-only format (still supported but not recommended):

```typescript
export const widgetMetadata: WidgetMetadata = {
  description: "Weather widget",
  props: propSchema,
  appsSdkMetadata: {
    // ChatGPT only - snake_case with openai/ prefix
    "openai/widgetCSP": {
      connect_domains: ["https://api.weather.com"],
      resource_domains: ["https://cdn.weather.com"],
    },
    "openai/widgetPrefersBorder": true,
    "openai/toolInvocation/invoking": "Loading...",
    "openai/toolInvocation/invoked": "Loaded",
  },
};
```

**Migration Note**: The old format uses `appsSdkMetadata` with `openai/` prefixes and snake_case (e.g., `connect_domains`). The new format uses `metadata` with camelCase (e.g., `connectDomains`) and works for both protocols.

### Using Both for Custom ChatGPT Features

You can combine both fields to use standard metadata plus ChatGPT-specific overrides:

```typescript
export const widgetMetadata: WidgetMetadata = {
  description: "Weather widget",
  props: propSchema,
  // Unified metadata (dual-protocol)
  metadata: {
    csp: { connectDomains: ["https://api.weather.com"] },
    prefersBorder: true,
  },
  // ChatGPT-specific overrides/additions
  appsSdkMetadata: {
    "openai/widgetDescription": "ChatGPT-specific description",
    "openai/customFeature": "some-value", // Any custom OpenAI metadata
    "openai/locale": "en-US",
  },
};
```

**Use Case**: When you need to pass custom OpenAI-specific metadata that doesn't exist in the unified format, add it to `appsSdkMetadata`. The fields will be passed directly to ChatGPT with the `openai/` prefix

## useWidget Hook

The `useWidget` hook provides everything you need:

```tsx
const {
  // Widget props from tool input
  props,

  // Loading state (true = tool still executing)
  isPending,

  // Persistent widget state
  state,
  setState,

  // Theme from host (light/dark)
  theme,

  // Call other MCP tools
  callTool,

  // Display mode control
  displayMode,
  requestDisplayMode,

  // Additional tool output
  output,
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
return <div>{isPending ? <LoadingSpinner /> : <div>{props.city}</div>}</div>;

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
    const result = await callTool("get-weather", {
      city: "Tokyo",
    });
    console.log("Result:", result.content);
  } catch (error) {
    console.error("Tool call failed:", error);
  }
};
```

### Display Mode Control

Request different display modes:

```tsx
const { displayMode, requestDisplayMode } = useWidget();

const goFullscreen = async () => {
  await requestDisplayMode("fullscreen");
};

// Current mode: 'inline' | 'pip' | 'fullscreen'
console.log(displayMode);
```

## Custom Tools with Widgets

Create tools that return widgets with dual-protocol support:

```typescript
import { MCPServer, widget, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "weather-app",
  version: "1.0.0",
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
    // Fetch data from API
    const data = await fetchWeatherAPI(city);

    // Return widget with runtime data
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

**Key Points:**

- `baseUrl` in server config enables proper asset loading
- Widget works with BOTH ChatGPT and MCP Apps clients automatically
- `widget: { name, invoking, invoked }` on tool definition
- `widget({ props, output })` helper returns runtime data
- `props` passed to widget, `output` shown to model
- Widget must exist in `resources/` folder

## Static Assets

Use the `public/` folder for images, fonts, etc:

```
my-app/
├── resources/
├── public/              # Static assets
│   ├── images/
│   │   ├── logo.svg
│   │   └── banner.png
│   └── fonts/
└── index.ts
```

**Using assets in widgets:**

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
      autoSize // Auto-resize widget
      viewControls // Add debug/fullscreen buttons
      debug // Show debug info
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

function MyWidget() {
  return (
    <div>
      <Image src="/images/photo.jpg" alt="Photo" />
      <Image src="data:image/png;base64,..." alt="Data URL" />
    </div>
  );
}
```

### ErrorBoundary

Graceful error handling:

```tsx
import { ErrorBoundary } from "mcp-use/react";

function MyWidget() {
  return (
    <ErrorBoundary
      fallback={<div>Something went wrong</div>}
      onError={(error) => console.error(error)}
    >
      <MyComponent />
    </ErrorBoundary>
  );
}
```

## Testing

### Using the Inspector

1. **Start development server:**

   ```bash
   yarn dev
   ```

2. **Open Inspector:**
   - Navigate to `http://localhost:3000/inspector`
3. **Test widgets:**

   - Click Tools tab
   - Find your widget tool
   - Enter test parameters
   - Execute to see widget render

4. **Debug interactions:**
   - Use browser console
   - Check RPC logs
   - Test state persistence
   - Verify tool calls

### Testing in ChatGPT

1. **Enable Developer Mode:**

   - Settings -> Connectors -> Advanced -> Developer mode

2. **Add your server:**

   - Go to Connectors tab
   - Add remote MCP server URL

3. **Test in conversation:**
   - Select Developer Mode from Plus menu
   - Choose your connector
   - Ask ChatGPT to use your tools

**Prompting tips:**

- Be explicit: "Use the weather-app connector's get-weather tool..."
- Disallow alternatives: "Do not use built-in tools, only use my connector"
- Specify input: "Call get-weather with { city: 'Tokyo' }"

**Dual-Protocol Note**: When using `type: "mcpApps"` in your server configuration, your widgets automatically work in both ChatGPT (via Apps SDK) and MCP Apps clients (like Claude Desktop, Goose). You can test the same widget in multiple clients without any code changes!

## Best Practices

### Schema Design

Use descriptive schemas:

```typescript
// Good
const schema = z.object({
  city: z.string().describe("City name (e.g., Tokyo, Paris)"),
  temperature: z.number().min(-50).max(60).describe("Temp in Celsius"),
});

// Bad
const schema = z.object({
  city: z.string(),
  temp: z.number(),
});
```

### Theme Support

Always support both themes:

```tsx
const { theme } = useWidget();

const bgColor = theme === "dark" ? "bg-gray-900" : "bg-white";
const textColor = theme === "dark" ? "text-white" : "text-gray-900";
```

### Loading States

Always check `isPending` first:

```tsx
const { props, isPending } = useWidget<MyProps>();

if (isPending) {
  return <LoadingSpinner />;
}

// Now safe to access props.field
return <div>{props.field}</div>;
```

### Widget Focus

Keep widgets focused:

```typescript
// Good: Single purpose
export const widgetMetadata: WidgetMetadata = {
  description: "Display weather for a city",
  props: z.object({ city: z.string() }),
};

// Bad: Too many responsibilities
export const widgetMetadata: WidgetMetadata = {
  description: "Weather, forecast, map, news, and more",
  props: z.object({
    /* many fields */
  }),
};
```

### Error Handling

Handle errors gracefully:

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

Set base URL for production:

```typescript
const server = new MCPServer({
  name: "my-app",
  version: "1.0.0",
  baseUrl: process.env.MCP_URL || "https://myserver.com",
});
```

### Environment Variables

```env
# Server URL
MCP_URL=https://myserver.com

# For static deployments
MCP_SERVER_URL=https://myserver.com/api
CSP_URLS=https://cdn.example.com,https://api.example.com
```

**Variable usage:**

- `MCP_URL`: Base URL for widget assets and CSP
- `MCP_SERVER_URL`: MCP server URL for tool calls (static deployments)
- `CSP_URLS`: Additional domains for Content Security Policy

## Deployment

### Deploy to mcp-use Cloud

```bash
# Login
npx mcp-use login

# Deploy
yarn deploy
```

### Build for Production

```bash
# Build
yarn build

# Start
yarn start
```

Build process:

- Compiles TypeScript
- Bundles React widgets
- Optimizes assets
- Generates production HTML

## Common Patterns

### Data Fetching Widget

```tsx
const DataWidget: React.FC = () => {
  const { props, isPending, callTool } = useWidget();

  if (isPending) {
    return <div>Loading...</div>;
  }

  const refresh = async () => {
    await callTool("fetch-data", { id: props.id });
  };

  return (
    <div>
      <h1>{props.title}</h1>
      <button onClick={refresh}>Refresh</button>
    </div>
  );
};
```

### Stateful Widget

```tsx
const CounterWidget: React.FC = () => {
  const { state, setState } = useWidget();

  const increment = async () => {
    await setState({
      count: (state?.count || 0) + 1,
    });
  };

  return (
    <div>
      <p>Count: {state?.count || 0}</p>
      <button onClick={increment}>+1</button>
    </div>
  );
};
```

### Themed Widget

```tsx
const ThemedWidget: React.FC = () => {
  const { theme } = useWidget();

  return (
    <div className={theme === "dark" ? "dark-theme" : "light-theme"}>
      Content
    </div>
  );
};
```

## Troubleshooting

### Widget Not Appearing

**Problem:** Widget file exists but tool doesn't appear

**Solutions:**

- Ensure `.tsx` extension
- Export `widgetMetadata` object
- Export default React component
- Check server logs for errors
- Verify widget name matches file/folder name

### Props Not Received

**Problem:** Component receives empty props

**Solutions:**

- Check `isPending` first (props empty while pending)
- Use `useWidget()` hook (not React props)
- Verify `widgetMetadata.props` is valid Zod schema
- Check tool parameters match schema

### CSP Errors

**Problem:** Widget loads but assets fail

**Solutions:**

- Set `baseUrl` in server config
- Add domains to CSP via `metadata.csp` (modern) or `appsSdkMetadata['openai/widgetCSP']` (legacy)
- Use HTTPS for all resources
- Check browser console for CSP violations

### CSP Errors in Production

**Problem:** Resources blocked by Content Security Policy in production

**Solutions:**
1. **Check browser console** for CSP violation messages
2. **Add missing domains** to your CSP configuration:
   ```typescript
   metadata: {
     csp: {
       connectDomains: ['https://api.example.com'], // Add missing API domain
       resourceDomains: ['https://cdn.example.com'], // Add missing CDN domain
     }
   }
   ```
3. **Use exact domains** - avoid wildcards in production
4. **Test in Inspector** before deploying to catch CSP issues early
5. **Environment variable alternative**: Set `CSP_URLS` environment variable with comma-separated domains

### Protocol Compatibility Issues

**Problem:** Widget works in ChatGPT but not MCP Apps clients (or vice versa)

**Solutions:**
- **Use `type: "mcpApps"`** for dual-protocol support (recommended)
- **Check `baseUrl`** is set correctly in server config
- **Verify metadata format**: Use `metadata` (camelCase) not `appsSdkMetadata` (snake_case) for dual-protocol
- **Test in Inspector** which supports both protocols

**When to use each type:**
- `type: "mcpApps"` - Maximum compatibility (recommended)
- `type: "appsSdk"` - ChatGPT only (use if you need ChatGPT-specific features not in spec)

## Learn More

- **Documentation**: https://docs.mcp-use.com
- **MCP Apps Standard**: https://docs.mcp-use.com/typescript/server/mcp-apps (dual-protocol guide)
- **Widget Guide**: https://docs.mcp-use.com/typescript/server/ui-widgets
- **Apps SDK Tutorial**: https://docs.mcp-use.com/typescript/server/creating-apps-sdk-server
- **Templates**: https://docs.mcp-use.com/typescript/server/templates
- **ChatGPT Apps Flow**: https://docs.mcp-use.com/guides/chatgpt-apps-flow
- **Inspector Debugging**: https://docs.mcp-use.com/inspector/debugging-chatgpt-apps
- **GitHub**: https://github.com/mcp-use/mcp-use

## Quick Reference

**Commands:**

- `npx create-mcp-use-app my-app --template mcp-apps` - Bootstrap
- `yarn dev` - Development with hot reload
- `yarn build` - Build for production
- `yarn start` - Run production server
- `yarn deploy` - Deploy to mcp-use Cloud

**Widget structure:**

- `resources/widget-name.tsx` - Single file widget
- `resources/widget-name/widget.tsx` - Folder-based widget entry
- `public/` - Static assets

**Widget metadata:**

- `description` - Widget description
- `props` - Zod schema for input
- `exposeAsTool` - Auto-register as tool (default: true)
- `metadata` - Unified config (dual-protocol, recommended)
- `metadata.csp` - Content Security Policy configuration
- `appsSdkMetadata` - ChatGPT-specific overrides (optional)

**CSP fields:**

- `connectDomains` - APIs to call
- `resourceDomains` - Static assets to load
- `frameDomains` - Iframes to embed
- `scriptDirectives` - Script policies

**useWidget hook:**

- `props` - Widget input parameters
- `isPending` - Loading state flag
- `state, setState` - Persistent state
- `callTool` - Call other tools
- `theme` - Current theme (light/dark)
- `displayMode, requestDisplayMode` - Display control

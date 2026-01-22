# MCP Apps Server

An MCP server with dual host support for both OpenAI Apps SDK and MCP Apps standard.

## Features

- **Dual Host Support**: Works with OpenAI ChatGPT (Apps SDK) and MCP Apps compliant hosts
- **Automatic Adaptation**: Widgets detect and adapt to the host environment automatically
- **Unified API**: Single `useWidget` hook works across all host types
- **React Widgets**: Interactive UI components built with React
- **TypeScript Support**: Full type safety with Zod schema validation

## Supported Host Types

| Host Type | Environment | MIME Type |
|-----------|-------------|-----------|
| `apps-sdk` | OpenAI ChatGPT | `text/html+skybridge` |
| `mcp-app` | MCP Apps compliant hosts | `text/html;profile=mcp-app` |
| `standalone` | Inspector / development | N/A |

## Getting Started

### Development

```bash
# Install dependencies
npm install

# Start development server with hot reloading
npm run dev
```

This will start:
- MCP server on port 3000
- Widget serving at `/mcp-use/widgets/*`
- Inspector UI at `/inspector`

### Production

```bash
# Build the server and widgets
npm run build

# Run the built server
npm start
```

## How It Works

### The useWidget Hook

The `useWidget` hook from `mcp-use/react` provides a unified API that automatically adapts to the host environment:

```typescript
import { useWidget } from "mcp-use/react";

function MyWidget() {
  const {
    props,        // Widget props from tool invocation
    hostType,     // 'apps-sdk' | 'mcp-app' | 'standalone'
    theme,        // 'light' | 'dark'
    callTool,     // Call MCP tools
    sendMessage,  // Send followup messages
    openLink,     // Open external links
  } = useWidget<MyWidgetProps>();

  return <div>Host: {hostType}</div>;
}
```

### Host Detection

The widget automatically detects the host environment:

1. **OpenAI Apps SDK** (`apps-sdk`): Detected when `window.openai` is available
2. **MCP Apps** (`mcp-app`): Detected when running in an iframe without `window.openai`
3. **Standalone** (`standalone`): When neither of the above (Inspector, direct browser access)

### Dual Resource Registration

Each widget is automatically registered with two resource URIs:

- **Apps SDK**: `ui://widget/{name}.html` with `text/html+skybridge`
- **MCP Apps**: `ui://widget/{name}-mcp.html` with `text/html;profile=mcp-app`

## Creating Widgets

### 1. Create the Widget Component

```typescript
// resources/my-widget/widget.tsx
import React from "react";
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import { propSchema, type MyWidgetProps } from "./types";

export const widgetMetadata: WidgetMetadata = {
  description: "My custom widget",
  props: propSchema,
};

function MyWidget() {
  const { props, hostType, callTool } = useWidget<MyWidgetProps>();

  return (
    <McpUseProvider autoSize>
      <div>
        <h1>Running on: {hostType}</h1>
        <p>Props: {JSON.stringify(props)}</p>
        <button onClick={() => callTool("my-tool", {})}>
          Call Tool
        </button>
      </div>
    </McpUseProvider>
  );
}

export default MyWidget;
```

### 2. Define Props with Zod Schema

```typescript
// resources/my-widget/types.ts
import { z } from "zod";

export const propSchema = z.object({
  title: z.string().optional(),
  items: z.array(z.string()).optional(),
});

export type MyWidgetProps = z.infer<typeof propSchema>;
```

### 3. Automatic Registration

Widgets in the `resources/` folder are automatically:
- Registered as MCP tools
- Registered as Apps SDK resources (`text/html+skybridge`)
- Registered as MCP Apps resources (`text/html;profile=mcp-app`)

## API Reference

### useWidget Hook

```typescript
interface UseWidgetResult<TProps> {
  // State
  props: TProps | undefined;
  hostType: 'apps-sdk' | 'mcp-app' | 'standalone';
  theme: 'light' | 'dark';
  displayMode: 'inline' | 'fullscreen' | 'pip';
  locale: string;
  maxHeight: number;
  safeArea: SafeArea;
  userAgent: UserAgent;

  // Tool output (for processing tool results)
  toolOutput: unknown | null;
  toolResponseMetadata: unknown | null;
  widgetState: unknown | null;

  // Actions
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResponse>;
  sendMessage: (message: string) => Promise<void>;
  openLink: (href: string) => void;
  requestDisplayMode: (mode: DisplayMode) => Promise<{ mode: DisplayMode }>;
  setWidgetState: <T>(state: T) => Promise<void>;

  // URLs
  mcp_url: string;
  public_url: string;
}
```

### Host-Specific Behavior

| Method | Apps SDK | MCP Apps | Standalone |
|--------|----------|----------|------------|
| `callTool` | `window.openai.callTool()` | `app.callServerTool()` | HTTP POST |
| `sendMessage` | `window.openai.sendFollowUpMessage()` | `app.sendMessage()` | Console log |
| `openLink` | `window.openai.openExternal()` | `app.openLink()` | `window.open()` |

## Testing

### Via Inspector UI

1. Start the server: `npm run dev`
2. Open: `http://localhost:3000/inspector`
3. Test tools and resources

### Direct Browser Access

Visit: `http://localhost:3000/mcp-use/widgets/task-manager`

### Via MCP Client

```typescript
// Call as tool
const result = await client.callTool('task-manager', {
  initialTasks: [{ id: '1', title: 'Test', completed: false, priority: 'high' }],
});

// Access as Apps SDK resource
const appsSdkResource = await client.readResource('ui://widget/task-manager.html');

// Access as MCP Apps resource
const mcpAppResource = await client.readResource('ui://widget/task-manager-mcp.html');
```

## Dependencies

- `mcp-use`: Core MCP framework with dual host support
- `@modelcontextprotocol/ext-apps`: MCP Apps standard client library
- `react`: UI framework
- `zod`: Schema validation

## Learn More

- [MCP Documentation](https://modelcontextprotocol.io)
- [OpenAI Apps SDK](https://developers.openai.com/apps-sdk)
- [MCP Apps Standard (SEP-1865)](https://github.com/modelcontextprotocol/specification)
- [mcp-use Documentation](https://github.com/mcp-use/mcp-use)

Happy building! 🚀

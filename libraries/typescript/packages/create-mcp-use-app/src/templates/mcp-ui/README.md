# UIResource MCP Server

[![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-use%2Ftree%2Fmain%2Flibraries%2Ftypescript%2Fpackages%2Fcreate-mcp-use-app%2Fsrc%2Ftemplates%2Fmcp-ui&branch=main&project-name=mcp-ui-template&build-command=npm+install&start-command=npm+run+build+%26%26+npm+run+start&port=3000&runtime=node&base-image=node%3A18)

An MCP server with the new UIResource integration for simplified widget management and MCP-UI compatibility.

## Features

- **🚀 UIResource Method**: Single method to register both tools and resources
- **🎨 React Widgets**: Interactive UI components built with React
- **🔄 Automatic Registration**: Tools and resources created automatically
- **📦 Props to Parameters**: Widget props automatically become tool parameters
- **🌐 MCP-UI Compatible**: Full compatibility with MCP-UI clients
- **🛠️ TypeScript Support**: Complete type safety and IntelliSense

## What's New: UIResource

The `uiResource` method is a powerful new addition that simplifies widget registration:

```typescript
// Old way: Manual registration of tool and resource
server.tool({
  /* tool config */
})
server.resource({
  /* resource config */
})

// New way: Single method does both!
server.uiResource({
  name: 'kanban-board',
  widget: 'kanban-board',
  title: 'Kanban Board',
  props: {
    initialTasks: { type: 'array', required: false },
    theme: { type: 'string', default: 'light' },
  },
})
```

This automatically creates:

- **Tool**: `kanban-board` - Accepts parameters and returns UIResource
- **Resource**: `ui://widget/kanban-board` - Static access with defaults

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

### Deploy to Supabase

See [DEPLOY_SUPABASE.md](./DEPLOY_SUPABASE.md) for a complete guide on deploying your MCP server with widgets to Supabase Edge Functions.

## Basic Usage

### Simple Widget Registration

```typescript
import { createMCPServer } from 'mcp-use/server'

const server = createMCPServer('my-server', {
  version: '1.0.0',
  description: 'Server with UIResource widgets',
})

// Register a widget - creates both tool and resource
server.uiResource({
  name: 'my-widget',
  widget: 'my-widget',
  title: 'My Widget',
  description: 'An interactive widget',
})

server.listen(3000)
```

### Widget with Props

```typescript
server.uiResource({
  name: 'data-chart',
  widget: 'chart',
  title: 'Data Chart',
  description: 'Interactive data visualization',
  props: {
    data: {
      type: 'array',
      description: 'Data points to display',
      required: true,
    },
    chartType: {
      type: 'string',
      description: 'Type of chart (line/bar/pie)',
      default: 'line',
    },
    theme: {
      type: 'string',
      description: 'Visual theme',
      default: 'light',
    },
  },
  size: ['800px', '400px'], // Preferred iframe size
  annotations: {
    audience: ['user', 'assistant'],
    priority: 0.8,
  },
})
```

## Widget Development

### 1. Create Your Widget Component

```typescript
// resources/my-widget.tsx
import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

interface MyWidgetProps {
  initialData?: any
  theme?: 'light' | 'dark'
}

const MyWidget: React.FC<MyWidgetProps> = ({
  initialData = [],
  theme = 'light',
}) => {
  const [data, setData] = useState(initialData)

  // Load props from URL query parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    const dataParam = params.get('initialData')
    if (dataParam) {
      try {
        setData(JSON.parse(dataParam))
      } catch (e) {
        console.error('Error parsing data:', e)
      }
    }

    const themeParam = params.get('theme')
    if (themeParam) {
      // Apply theme
    }
  }, [])

  return <div className={`widget theme-${theme}`}>{/* Your widget UI */}</div>
}

// Mount the widget
const container = document.getElementById('widget-root')
if (container) {
  createRoot(container).render(<MyWidget />)
}
```

### 2. Register with UIResource

```typescript
// src/server.ts
server.uiResource({
  name: 'my-widget',
  widget: 'my-widget',
  title: 'My Custom Widget',
  description: 'A custom interactive widget',
  props: {
    initialData: {
      type: 'array',
      description: 'Initial data for the widget',
      required: false,
    },
    theme: {
      type: 'string',
      description: 'Widget theme',
      default: 'light',
    },
  },
  size: ['600px', '400px'],
})
```

## How It Works

### Tool Registration

When you call `uiResource`, it automatically creates a tool:

- Name: `[widget-name]`
- Accepts all props as parameters
- Returns both text description and UIResource object

### Resource Registration

Also creates a resource:

- URI: `ui://widget/[widget-name]`
- Returns UIResource with default prop values
- Discoverable by MCP clients

### Parameter Passing

Tool parameters are automatically:

1. Converted to URL query parameters
2. Complex objects are JSON-stringified
3. Passed to widget via iframe URL

## Advanced Examples

### Multiple Widgets

```typescript
const widgets = [
  {
    name: 'todo-list',
    widget: 'todo-list',
    title: 'Todo List',
    props: {
      items: { type: 'array', default: [] },
    },
  },
  {
    name: 'calendar',
    widget: 'calendar',
    title: 'Calendar',
    props: {
      date: { type: 'string', required: false },
    },
  },
]

// Register all widgets
widgets.forEach((widget) => server.uiResource(widget))
```

### Mixed Registration

```typescript
// UIResource for widgets
server.uiResource({
  name: 'dashboard',
  widget: 'dashboard',
  title: 'Analytics Dashboard',
})

// Traditional tool for actions
server.tool({
  name: 'calculate',
  description: 'Perform calculations',
  cb: async (params) => {
    /* ... */
  },
})

// Traditional resource for data
server.resource({
  name: 'config',
  uri: 'config://app',
  mimeType: 'application/json',
  readCallback: async () => {
    /* ... */
  },
})
```

## API Reference

### `server.uiResource(definition)`

#### Parameters

- `definition: UIResourceDefinition`
  - `name: string` - Resource identifier
  - `widget: string` - Widget directory name
  - `title?: string` - Human-readable title
  - `description?: string` - Widget description
  - `props?: WidgetProps` - Widget properties configuration
  - `size?: [string, string]` - Preferred iframe size
  - `annotations?: ResourceAnnotations` - Discovery hints

#### WidgetProps

Each prop can have:

- `type: 'string' | 'number' | 'boolean' | 'object' | 'array'`
- `required?: boolean` - Whether the prop is required
- `default?: any` - Default value if not provided
- `description?: string` - Prop description

## Testing Your Widgets

### Via Inspector UI

1. Start the server: `npm run dev`
2. Open: `http://localhost:3000/inspector`
3. Test tools and resources

### Direct Browser Access

Visit: `http://localhost:3000/mcp-use/widgets/[widget-name]`

### Via MCP Client

```typescript
// Call as tool
const result = await client.callTool('kanban-board', {
  initialTasks: [...],
  theme: 'dark'
})

// Access as resource
const resource = await client.readResource('ui://widget/kanban-board')
```

## Benefits of UIResource

✅ **Simplified API** - One method instead of two
✅ **Automatic Wiring** - Props become tool inputs automatically
✅ **Type Safety** - Full TypeScript support
✅ **MCP-UI Compatible** - Works with all MCP-UI clients
✅ **DRY Principle** - No duplicate UIResource creation
✅ **Discoverable** - Both tools and resources are listed

## Troubleshooting

### Widget Not Loading

- Ensure widget exists in `dist/resources/mcp-use/widgets/`
- Check server console for errors
- Verify widget is registered with `uiResource()`

### Props Not Passed

- Check URL parameters in browser DevTools
- Ensure prop names match exactly
- Complex objects must be JSON-stringified

### Type Errors

- Import types: `import type { UIResourceDefinition } from 'mcp-use/server'`
- Ensure mcp-use is updated to latest version

## Migration from Old Pattern

If you have existing code using separate tool/resource:

```typescript
// Old pattern
server.tool({ name: 'show-widget' /* ... */ })
server.resource({ uri: 'ui://widget' /* ... */ })

// New pattern - replace both with:
server.uiResource({
  name: 'widget',
  widget: 'widget',
  // ... consolidated configuration
})
```

## Future Enhancements

Coming soon:

- Automatic widget discovery from filesystem
- Widget manifests (widget.json)
- Prop extraction from TypeScript interfaces
- Build-time optimization

## Learn More

- [MCP Documentation](https://modelcontextprotocol.io)
- [MCP-UI Documentation](https://github.com/idosal/mcp-ui)
- [mcp-use Documentation](https://github.com/pyroprompt/mcp-use)
- [React Documentation](https://react.dev/)

Happy widget building! 🚀

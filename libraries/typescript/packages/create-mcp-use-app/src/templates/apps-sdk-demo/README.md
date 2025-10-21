# Pizzaz MCP Server - OpenAI Apps SDK Reference

An MCP server demonstrating OpenAI Apps SDK integration using `mcp-use`. This implementation showcases the **pizzaz reference widgets** that demonstrate Apps SDK best practices.

## 🌟 Features

- **🍕 Pizzaz Widgets**: 5 reference widgets from OpenAI's Apps SDK examples
- **🚀 Apps SDK Integration**: Full OpenAI Apps SDK metadata support
- **📦 Automatic Registration**: Tools and resources created automatically
- **🔒 Content Security Policy**: Proper CSP configuration for external resources
- **⚡ Tool Invocation Status**: Real-time status messages during tool execution
- **🎨 External Resources**: Load scripts and styles from OpenAI's CDN
- **🛠️ TypeScript Support**: Complete type safety and IntelliSense

## 📋 What's Included

### Pizzaz Widgets

This server includes all 5 pizzaz reference widgets:

1. **pizza-map** - Interactive map widget
2. **pizza-carousel** - Carousel browsing widget
3. **pizza-albums** - Album gallery widget
4. **pizza-list** - List view widget
5. **pizza-video** - Video player widget

Each widget demonstrates:

- External resource loading from OpenAI CDN
- Apps SDK metadata configuration
- Structured content injection
- Tool invocation status messages

## 🚀 Getting Started

### Development

```bash
# Install dependencies
npm install

# Start development server with hot reloading
npm run dev
```

This will start:

- MCP server on port 8000
- Inspector UI at `/inspector`
- SSE endpoint at `/mcp`

### Production

```bash
# Build the server
npm run build

# Run the built server
npm start
```

## 📖 Usage

### Via MCP Client

```typescript
import { createMCPClient } from 'mcp-use/client'

const client = createMCPClient({
  serverUrl: 'http://localhost:8000/mcp',
})

// Call a pizzaz widget tool
const result = await client.callTool('ui_pizza-map', {
  pizzaTopping: 'pepperoni',
})

// Access widget template as resource
const resource = await client.readResource('ui://widget/pizza-map.html')

// List all available widgets
const widgetList = await client.callTool('list-widgets', {})

// Get info about a specific widget
const widgetInfo = await client.callTool('get-widget-info', {
  widgetId: 'pizza-carousel',
})
```

### Via Inspector UI

1. Start the server: `npm run dev`
2. Open: `http://localhost:8000/inspector`
3. Test tools and resources interactively

### Direct HTTP Access

```bash
# SSE connection
curl -N http://localhost:8000/mcp

# Post message (requires sessionId)
curl -X POST http://localhost:8000/mcp/messages?sessionId=<session-id> \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/list"}'
```

## 🎯 How It Works

### Apps SDK Integration

The server uses `mcp-use`'s `AppsSdkUIResource` type to create Apps SDK compatible widgets:

```typescript
import type { AppsSdkUIResource } from 'mcp-use/server'

const widget: AppsSdkUIResource = {
  type: 'appsSdk',
  name: 'pizza-map',
  title: 'Show Pizza Map',
  description: 'Interactive map widget',
  htmlTemplate: `
    <div id="pizzaz-root"></div>
    <link rel="stylesheet" href="https://persistent.oaistatic.com/...">
    <script type="module" src="https://persistent.oaistatic.com/..."></script>
  `,
  props: {
    pizzaTopping: {
      type: 'string',
      description: 'Topping to mention',
      required: true,
    },
  },
  appsSdkMetadata: {
    'openai/widgetDescription': 'Interactive map widget',
    'openai/toolInvocation/invoking': 'Hand-tossing a map',
    'openai/toolInvocation/invoked': 'Served a fresh map',
    'openai/widgetAccessible': true,
    'openai/widgetCSP': {
      connect_domains: [],
      resource_domains: ['https://persistent.oaistatic.com'],
    },
  },
}

server.uiResource(widget)
```

This automatically:

1. Creates a tool (`ui_pizza-map`)
2. Creates a resource (`ui://widget/pizza-map.html`)
3. Sets MIME type to `text/html+skybridge`
4. Injects Apps SDK metadata
5. Handles structured content injection

### Widget Registration

Widgets are defined in `src/widgets.ts` and registered in `src/server.ts`:

```typescript
import { getPizzazUIResources } from './widgets.js'

const pizzazWidgets = getPizzazUIResources()

pizzazWidgets.forEach((widget) => {
  server.uiResource(widget)
})
```

### Structured Content

When a tool is called, the `structuredContent` is automatically injected as `window.openai.toolOutput`:

```typescript
// In your tool handler
return {
  content: [
    {
      type: 'text',
      text: 'Rendered a pizza map!',
    },
  ],
  structuredContent: {
    pizzaTopping: params.pizzaTopping,
  },
}

// Widget can access it via:
// window.openai.toolOutput.pizzaTopping
```

## 📚 Apps SDK Metadata

Each widget includes rich Apps SDK metadata:

### Widget Description

```typescript
'openai/widgetDescription': 'Interactive map widget for displaying pizza locations'
```

### Tool Invocation Status

```typescript
'openai/toolInvocation/invoking': 'Hand-tossing a map'
'openai/toolInvocation/invoked': 'Served a fresh map'
```

### Content Security Policy

```typescript
'openai/widgetCSP': {
  connect_domains: [],  // Domains widget can connect to
  resource_domains: ['https://persistent.oaistatic.com']  // CDN domains
}
```

### Accessibility

```typescript
'openai/widgetAccessible': true
```

### Output Template

```typescript
'openai/outputTemplate': 'ui://widget/pizza-map.html'
```

## 🔧 Configuration

### Port Configuration

Set the port via environment variable:

```bash
PORT=3000 npm start
```

Default port is `8000`.

### Widget Customization

To add or modify widgets, edit `src/widgets.ts`:

```typescript
export const pizzazWidgets: PizzazWidgetDefinition[] = [
  {
    id: 'my-widget',
    title: 'My Custom Widget',
    description: 'A custom widget',
    templateUri: 'ui://widget/my-widget.html',
    invoking: 'Loading widget...',
    invoked: 'Widget ready!',
    html: `
      <div id="widget-root"></div>
      <script>
        // Your widget code
      </script>
    `,
    responseText: 'Widget rendered!',
  },
  // ... other widgets
]
```

## 🎨 Widget Structure

Each pizzaz widget follows this structure:

```html
<!-- Container div with specific ID -->
<div id="pizzaz-root"></div>

<!-- External stylesheet -->
<link rel="stylesheet" href="https://persistent.oaistatic.com/..." />

<!-- External script (type="module") -->
<script type="module" src="https://persistent.oaistatic.com/..."></script>
```

The external scripts:

- Render interactive components into the container
- Access structured content via `window.openai.toolOutput`
- Handle user interactions
- Communicate with parent via postMessage

## 🛠️ Available Tools

### Widget Tools

Each pizzaz widget creates a tool:

- `ui_pizza-map` - Display interactive map
- `ui_pizza-carousel` - Browse in carousel format
- `ui_pizza-albums` - Show album gallery
- `ui_pizza-list` - Display list view
- `ui_pizza-video` - Play video content

All accept a `pizzaTopping` parameter:

```typescript
await client.callTool('ui_pizza-map', {
  pizzaTopping: 'pepperoni',
})
```

### Helper Tools

- `list-widgets` - Get list of all available widgets
- `get-widget-info` - Get detailed info about a specific widget

## 📦 Available Resources

Each widget template is available as a resource:

- `ui://widget/pizza-map.html`
- `ui://widget/pizza-carousel.html`
- `ui://widget/pizza-albums.html`
- `ui://widget/pizza-list.html`
- `ui://widget/pizza-video.html`

Plus:

- `config://server` - Server configuration (JSON)

## 🔍 Testing

### Test with Inspector

1. Start server: `npm run dev`
2. Open inspector: `http://localhost:8000/inspector`
3. Click on any widget tool
4. Enter a pizza topping
5. Execute and view the result

### Test with MCP Client

```typescript
import { createMCPClient } from 'mcp-use/client'

const client = createMCPClient({
  serverUrl: 'http://localhost:8000/mcp',
})

// Test listing tools
const tools = await client.listTools()
console.log('Available tools:', tools)

// Test calling a widget
const result = await client.callTool('ui_pizza-map', {
  pizzaTopping: 'mushroom',
})
console.log('Result:', result)

// Test reading resource
const resource = await client.readResource('ui://widget/pizza-map.html')
console.log('Resource:', resource)
```

## 📂 Project Structure

```
apps-sdk/
├── index.ts                # Entry point
├── package.json            # Dependencies
├── tsconfig.json          # TypeScript config
├── README.md              # This file
└── src/
    ├── server.ts          # Main server implementation
    └── widgets.ts         # Pizzaz widget definitions
```

## 🔗 Related Documentation

- [MCP Documentation](https://modelcontextprotocol.io)
- [MCP-UI Apps SDK Guide](https://mcpui.dev/guide/apps-sdk)
- [mcp-use Documentation](https://github.com/pyroprompt/mcp-use)
- [OpenAI Apps SDK](https://platform.openai.com/docs/guides/apps)

## 🤝 Contributing

This is a reference implementation demonstrating Apps SDK integration patterns. Feel free to:

- Add new widget types
- Customize existing widgets
- Extend Apps SDK metadata
- Add additional tools and resources

## 📝 License

MIT

---

Built with ❤️ using [mcp-use](https://github.com/pyroprompt/mcp-use) and [OpenAI Apps SDK](https://platform.openai.com/docs/guides/apps)

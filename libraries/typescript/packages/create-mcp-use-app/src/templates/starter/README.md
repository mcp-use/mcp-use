# MCP Starter Server

[![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-use%2Ftree%2Fmain%2Flibraries%2Ftypescript%2Fpackages%2Fcreate-mcp-use-app%2Fsrc%2Ftemplates%2Fstarter&branch=main&project-name=starter-template&build-command=npm+install&start-command=npm+run+build+%26%26+npm+run+start&port=3000&runtime=node&base-image=node%3A18)

A comprehensive MCP server template with examples of tools, resources, prompts, and all UIResource types.

> 📚 **[View Full Documentation](https://docs.mcp-use.com/typescript/getting-started/quickstart)** - Complete guides, API references, and tutorials

## Features

- **🛠️ Tools**: Regular MCP tools and API integrations
- **📦 Resources**: Static and dynamic resources
- **📝 Prompts**: Reusable prompt templates
- **🎨 UIResources**: Three types of interactive widgets
  - External URL (React iframe widgets)
  - Remote DOM (MCP-UI components)
  - Apps SDK (OpenAI ChatGPT compatible)
- **🔥 Hot Reload**: Development server with auto-reload
- **🔍 Inspector UI**: Built-in testing interface
- **✅ TypeScript**: Full type safety

## What's Included

This starter template demonstrates all major MCP features:

### 1. Traditional Tools

```typescript
server.tool({
  name: 'greet',
  description: 'Greet someone by name',
  inputs: [{ name: 'name', type: 'string', required: true }],
  cb: async ({ name }) => {
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] }
  },
})
```

### 2. Resources

```typescript
server.resource({
  name: 'config',
  uri: 'config://settings',
  mimeType: 'application/json',
  readCallback: async () => ({
    /* ... */
  }),
})
```

### 3. Prompts

```typescript
server.prompt({
  name: 'review-code',
  description: 'Review code for best practices',
  args: [{ name: 'code', type: 'string', required: true }],
  cb: async ({ code }) => {
    /* ... */
  },
})
```

### 4. UIResources (3 Types)

#### A. External URL (Iframe Widget)

React components served from your filesystem:

```typescript
server.uiResource({
  type: 'externalUrl',
  name: 'kanban-board',
  widget: 'kanban-board',
  title: 'Kanban Board',
  props: {
    /* ... */
  },
})
```

#### B. Remote DOM (MCP-UI Components)

Lightweight widgets using MCP-UI React components:

```typescript
server.uiResource({
  type: 'remoteDom',
  name: 'quick-poll',
  script: `/* Remote DOM script */`,
  framework: 'react',
  props: {
    /* ... */
  },
})
```

#### C. Apps SDK (ChatGPT Compatible)

OpenAI Apps SDK widgets for ChatGPT integration:

```typescript
server.uiResource({
  type: 'appsSdk',
  name: 'pizzaz-map-apps-sdk',
  htmlTemplate: `<div id="pizzaz-root"></div>`,
  appsSdkMetadata: {
    /* OpenAI metadata */
  },
})
```

## Getting Started

### Installation

```bash
# Install dependencies
npm install
```

### Development

```bash
# Start development server with hot reloading
npm run dev
```

This starts:

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

See the [Deploying to Supabase documentation](https://docs.mcp-use.io/typescript/server/deployment-supabase) for a complete guide on deploying your MCP server to Supabase Edge Functions.

## Project Structure

```
starter/
├── src/
│   ├── server.ts          # Main server configuration
│   └── remoteDom/         # Remote DOM scripts
│       └── index.ts       # Quick poll script
├── resources/             # React widget components (root level!)
│   └── kanban-board.tsx
├── index.ts               # Entry point
├── package.json
├── tsconfig.json
└── README.md
```

## Available Tools

### `greet`

Simple greeting tool demonstrating basic tool structure.

```typescript
await client.callTool('greet', { name: 'Alice' })
// Returns: "Hello, Alice! Welcome to MCP."
```

### `fetch-weather`

Demonstrates async operations and external API calls.

```typescript
await client.callTool('fetch-weather', { city: 'London' })
// Returns: Weather information from wttr.in
```

### `ui_kanban-board`

Interactive Kanban board widget (External URL).

```typescript
await client.callTool('ui_kanban-board', {
  initialTasks: [{ id: '1', title: 'Task 1' /* ... */ }],
  theme: 'dark',
})
```

### `ui_quick-poll`

Quick polling widget (Remote DOM).

```typescript
await client.callTool('ui_quick-poll', {
  question: 'Favorite framework?',
  options: ['React', 'Vue', 'Svelte'],
})
```

### `ui_pizzaz-map-apps-sdk`

Pizza location map (Apps SDK).

```typescript
await client.callTool('ui_pizzaz-map-apps-sdk', {
  pizzaTopping: 'pepperoni',
})
```

## Available Resources

### `config://settings`

Server configuration resource.

```typescript
await client.readResource('config://settings')
```

### `ui://widget/kanban-board`

Static Kanban board widget with defaults.

```typescript
await client.readResource('ui://widget/kanban-board')
```

### `ui://widget/quick-poll`

Static quick poll widget with defaults.

```typescript
await client.readResource('ui://widget/quick-poll')
```

### `ui://widget/pizzaz-map-apps-sdk`

Static pizza map widget.

```typescript
await client.readResource('ui://widget/pizzaz-map-apps-sdk')
```

## Available Prompts

### `review-code`

Code review prompt template.

```typescript
await client.getPrompt('review-code', { code: 'const x = 1;' })
```

## Customization Guide

### Adding New Tools

1. Add to `src/server.ts`:

```typescript
server.tool({
  name: 'my-tool',
  description: 'My custom tool',
  inputs: [{ name: 'param', type: 'string', required: true }],
  cb: async ({ param }) => {
    // Your logic here
    return {
      content: [{ type: 'text', text: `Result: ${param}` }],
    }
  },
})
```

### Adding New React Widgets

1. Create widget in `resources/my-widget.tsx` (at root level):

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'

const MyWidget: React.FC = () => {
  return <div>My Widget</div>
}

const container = document.getElementById('widget-root')
if (container) {
  createRoot(container).render(<MyWidget />)
}
```

2. Register in `src/server.ts`:

```typescript
server.uiResource({
  type: 'externalUrl',
  name: 'my-widget',
  widget: 'my-widget',
  title: 'My Widget',
  description: 'My custom widget',
})
```

### Adding Remote DOM Widgets

1. Create script in `src/remoteDom/my-script.ts`:

```typescript
export const myScript = `
  const container = document.createElement('ui-stack');
  container.setAttribute('direction', 'column');

  const text = document.createElement('ui-text');
  text.textContent = 'Hello from Remote DOM!';
  container.appendChild(text);

  root.appendChild(container);
`
```

2. Register in `src/server.ts`:

```typescript
import { myScript } from './remoteDom/my-script'

server.uiResource({
  type: 'remoteDom',
  name: 'my-remote-widget',
  script: myScript,
  framework: 'react',
  encoding: 'text',
})
```

### Adding Resources

```typescript
server.resource({
  name: 'my-resource',
  uri: 'custom://my-data',
  mimeType: 'application/json',
  description: 'My custom resource',
  readCallback: async () => ({
    contents: [
      {
        uri: 'custom://my-data',
        mimeType: 'application/json',
        text: JSON.stringify({ data: 'value' }),
      },
    ],
  }),
})
```

### Adding Prompts

```typescript
server.prompt({
  name: 'my-prompt',
  description: 'My custom prompt',
  args: [{ name: 'input', type: 'string', required: true }],
  cb: async ({ input }) => ({
    content: [
      {
        type: 'text',
        text: `Process this input: ${input}`,
      },
    ],
  }),
})
```

## Testing Your Server

### Using the Inspector UI

1. Start the server: `npm run dev`
2. Open: `http://localhost:3000/inspector`
3. Test tools, resources, and prompts interactively

### Direct Browser Access

For External URL widgets:

```
http://localhost:3000/mcp-use/widgets/kanban-board
```

### Via MCP Client

```typescript
import { createMCPClient } from 'mcp-use/client'

const client = createMCPClient({
  serverUrl: 'http://localhost:3000/mcp',
})

await client.connect()

// Test tools
const result = await client.callTool('greet', { name: 'World' })

// Test resources
const config = await client.readResource('config://settings')

// Test prompts
const prompt = await client.getPrompt('review-code', { code: '...' })
```

## UIResource Types Comparison

| Type             | Use Case            | Complexity | Features                          |
| ---------------- | ------------------- | ---------- | --------------------------------- |
| **External URL** | Complex React apps  | High       | Full React, npm packages, routing |
| **Remote DOM**   | Lightweight widgets | Low        | MCP-UI components only            |
| **Apps SDK**     | ChatGPT integration | Medium     | OpenAI ecosystem compatibility    |

### When to Use Each

- **External URL**: Complex interactive UIs (dashboards, forms, games)
- **Remote DOM**: Simple widgets (buttons, cards, polls)
- **Apps SDK**: ChatGPT-specific integrations

## Environment Variables

```bash
PORT=3000  # Server port (default: 3000)
```

## Build Output

After running `npm run build`:

```
dist/
├── index.js              # Entry point
├── src/
│   ├── server.js         # Compiled server
│   └── remoteDom/
│       └── index.js
└── resources/
    └── mcp-use/
        └── widgets/
            └── kanban-board/
                └── index.html
```

## Troubleshooting

### Widget Not Loading

- Ensure `tsconfig.json` has `"jsx": "react-jsx"`
- Check `src/resources/` contains your widget file
- Verify widget is built in `dist/resources/mcp-use/widgets/`
- Check browser console for errors

### Props Not Passed to Widget

- Widgets receive props as URL query parameters
- Parse them in `useEffect` with `URLSearchParams`
- Complex objects are JSON-stringified

### Build Errors

```bash
# Clean build
rm -rf dist node_modules
npm install
npm run build
```

### Port Already in Use

```bash
# Change port
PORT=3001 npm run dev
```

## Examples

### Complete Weather Widget

1. **Create widget** (`resources/weather.tsx`):

```tsx
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

const Weather: React.FC = () => {
  const [city, setCity] = useState('London')
  const [weather, setWeather] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const cityParam = params.get('city')
    if (cityParam) setCity(cityParam)
  }, [])

  useEffect(() => {
    fetch(`https://wttr.in/${city}?format=j1`)
      .then((r) => r.json())
      .then(setWeather)
  }, [city])

  if (!weather) return <div>Loading...</div>

  return (
    <div style={{ padding: 20 }}>
      <h1>Weather in {city}</h1>
      <p>{weather.current_condition[0].temp_C}°C</p>
    </div>
  )
}

const container = document.getElementById('widget-root')
if (container) createRoot(container).render(<Weather />)
```

2. **Register** (`src/server.ts`):

```typescript
server.uiResource({
  type: 'externalUrl',
  name: 'weather-widget',
  widget: 'weather',
  title: 'Weather Widget',
  props: {
    city: { type: 'string', default: 'London' },
  },
})
```

3. **Use**:

```typescript
await client.callTool('ui_weather-widget', { city: 'Paris' })
```

## Learn More

- [MCP Documentation](https://modelcontextprotocol.io)
- [MCP-UI Documentation](https://github.com/idosal/mcp-ui)
- [mcp-use Documentation](https://github.com/pyroprompt/mcp-use)
- [React Documentation](https://react.dev/)
- [OpenAI Apps SDK](https://platform.openai.com/docs/apps)

## License

MIT

---

> 📚 **[View Full Documentation](https://docs.mcp-use.com/typescript/getting-started/quickstart)** - For more guides and advanced features

Happy building! 🚀

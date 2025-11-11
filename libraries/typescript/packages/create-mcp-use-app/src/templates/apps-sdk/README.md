# Apps SDK MCP Server

[![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-use%2Ftree%2Fmain%2Flibraries%2Ftypescript%2Fpackages%2Fcreate-mcp-use-app%2Fsrc%2Ftemplates%2Fapps-sdk&branch=main&project-name=apps-sdk-template&build-command=npm+install&start-command=npm+run+build+%26%26+npm+run+start&port=3000&runtime=node&base-image=node%3A18)

An MCP server template with OpenAI Apps SDK integration for ChatGPT-compatible widgets.

## Features

- **🤖 OpenAI Apps SDK**: Full compatibility with ChatGPT widgets
- **🎨 React Widgets**: Interactive UI components with theme support
- **🔄 Automatic Registration**: Widgets auto-register from `resources/` folder
- **📦 Props Schema**: Zod schema validation for widget props
- **🌙 Theme Support**: Dark/light theme detection via `useWidget` hook
- **🛠️ TypeScript**: Complete type safety

## What's New: Apps SDK Integration

This template demonstrates how to build ChatGPT-compatible widgets using OpenAI's Apps SDK:

```typescript
import { useWidget } from 'mcp-use/react';

const MyWidget: React.FC = () => {
  const { props, theme } = useWidget<MyProps>();

  // props contains validated inputs from OpenAI
  // theme is 'dark' or 'light' based on ChatGPT setting
}
```

## Getting Started

### Development

```bash
# Install dependencies
npm install

# Start development server
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

See the [Deploying to Supabase documentation](https://docs.mcp-use.io/typescript/server/deployment-supabase) for a complete guide on deploying your MCP server with widgets to Supabase Edge Functions.

## Project Structure

```
apps-sdk/
├── resources/                  # React widget components
│   └── display-weather.tsx      # Weather widget example
├── index.ts                     # Server entry point
├── package.json
├── tsconfig.json
└── README.md
```

## How Automatic Registration Works

All React components in the `resources/` folder are automatically registered as MCP tools and resources when they export `widgetMetadata`:

```typescript
import { z } from 'zod';

const propSchema = z.object({
  city: z.string().describe('The city name'),
  temperature: z.number().describe('Temperature in Celsius'),
});

export const widgetMetadata = {
  description: 'My widget description',
  inputs: propSchema,
};

const MyWidget: React.FC = () => {
  const { props } = useWidget<z.infer<typeof propSchema>>();
  // Your widget implementation
};

export default MyWidget;
```

This automatically creates:
- **Tool**: `display-weather` - Accepts parameters via OpenAI
- **Resource**: `ui://widget/display-weather` - Static access

## Building Widgets with Apps SDK

### Using the `useWidget` Hook

```typescript
import { useWidget } from 'mcp-use/react';

interface MyProps {
  title: string;
  count: number;
}

const MyWidget: React.FC = () => {
  const { props, theme } = useWidget<MyProps>();

  // props are validated and typed based on your schema
  // theme is automatically set by ChatGPT

  return (
    <div className={theme === 'dark' ? 'dark-theme' : 'light-theme'}>
      <h1>{props.title}</h1>
      <p>Count: {props.count}</p>
    </div>
  );
};
```

### Defining Widget Metadata

Use Zod schemas to define widget inputs:

```typescript
import { z } from 'zod';

const propSchema = z.object({
  name: z.string().describe('Person name'),
  age: z.number().min(0).max(120).describe('Age in years'),
  email: z.string().email().describe('Email address'),
});

export const widgetMetadata = {
  description: 'Display user information',
  inputs: propSchema,
};
```

### Theme Support

Automatically adapt to ChatGPT's theme:

```typescript
const { theme } = useWidget();

const bgColor = theme === 'dark' ? 'bg-gray-900' : 'bg-white';
const textColor = theme === 'dark' ? 'text-gray-100' : 'text-gray-800';
```

## Example: Weather Widget

The included `display-weather.tsx` widget demonstrates:

1. **Schema Definition**: Zod schema for validation
2. **Metadata Export**: Widget registration info
3. **Theme Detection**: Dark/light mode support
4. **Type Safety**: Full TypeScript support

```typescript
// Get props from OpenAI Apps SDK
const { props, theme } = useWidget<WeatherProps>();

// props.city, props.weather, props.temperature are validated
```

## Using Widgets in ChatGPT

### Via Tool Call

```typescript
await client.callTool('display-weather', {
  city: 'San Francisco',
  weather: 'sunny',
  temperature: 22
});
```

### Via Resource Access

```typescript
await client.readResource('ui://widget/display-weather');
```

## Customization Guide

### Adding New Widgets

1. Create a React component in `resources/my-widget.tsx`:

```tsx
import React from 'react';
import { z } from 'zod';
import { useWidget } from 'mcp-use/react';

const propSchema = z.object({
  message: z.string().describe('Message to display'),
});

export const widgetMetadata = {
  description: 'Display a message',
  inputs: propSchema,
};

type Props = z.infer<typeof propSchema>;

const MyWidget: React.FC = () => {
  const { props, theme } = useWidget<Props>();

  return (
    <div>
      <h1>{props.message}</h1>
    </div>
  );
};

export default MyWidget;
```

2. The widget is automatically registered!

### Adding Traditional MCP Tools

You can mix Apps SDK widgets with regular MCP tools:

```typescript
server.tool({
  name: 'get-data',
  description: 'Fetch data from API',
  cb: async () => {
    return { content: [{ type: 'text', text: 'Data' }] };
  },
});
```

## Testing Your Widgets

### Via Inspector UI

1. Start the server: `npm run dev`
2. Open: `http://localhost:3000/inspector`
3. Test widgets interactively

### Direct Browser Access

Visit: `http://localhost:3000/mcp-use/widgets/display-weather`

### Via MCP Client

```typescript
import { createMCPClient } from 'mcp-use/client';

const client = createMCPClient({
  serverUrl: 'http://localhost:3000/mcp',
});

await client.connect();

// Call widget as tool
const result = await client.callTool('display-weather', {
  city: 'London',
  weather: 'rain',
  temperature: 15
});
```

## Apps SDK vs Other Widget Types

| Feature           | Apps SDK           | External URL | Remote DOM |
| ----------------- | ------------------ | ------------ | ---------- |
| ChatGPT Compatible | ✅ Yes            | ❌ No        | ❌ No      |
| Theme Detection   | ✅ Automatic      | ❌ Manual    | ❌ Manual  |
| Props Validation  | ✅ Zod Schema     | ❌ Manual    | ❌ Manual  |
| React Support     | ✅ Full           | ✅ Full      | ❌ Limited |
| OpenAI Metadata   | ✅ Yes            | ❌ No        | ❌ No      |

## Benefits of Apps SDK

✅ **ChatGPT Native** - Works seamlessly in ChatGPT
✅ **Theme Aware** - Automatic dark/light mode
✅ **Type Safe** - Full TypeScript with Zod validation
✅ **Simple API** - One hook for all props
✅ **Auto Registration** - Export metadata and done

## Troubleshooting

### Widget Not Loading

- Ensure widget has `widgetMetadata` export
- Check Zod schema is valid
- Verify widget exists in `dist/resources/mcp-use/widgets/`

### Props Not Passed

- Ensure schema includes all props
- Check `.describe()` for each prop
- Verify `useWidget` hook is called

### Theme Not Applied

- Theme is only available in ChatGPT
- Use `theme` from `useWidget()` hook
- Test in actual ChatGPT interface

## Migration from Other Templates

Moving from `starter` to `apps-sdk`:

```typescript
// Before: Manual props handling
const params = new URLSearchParams(window.location.search);
const city = params.get('city');

// After: Apps SDK hook
const { props } = useWidget();
const city = props.city;
```

## Learn More

- [MCP Documentation](https://modelcontextprotocol.io)
- [OpenAI Apps SDK](https://platform.openai.com/docs/apps)
- [mcp-use Documentation](https://docs.mcp-use.com)
- [React Documentation](https://react.dev/)
- [Zod Documentation](https://zod.dev/)

Happy building! 🚀

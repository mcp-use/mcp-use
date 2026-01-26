# MCP Apps Server

[![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-use%2Ftree%2Fmain%2Flibraries%2Ftypescript%2Fpackages%2Fcreate-mcp-use-app%2Fsrc%2Ftemplates%2Fmcp-apps&branch=main&project-name=mcp-apps-template&build-command=npm+install&start-command=npm+run+build+%26%26+npm+run+start&port=3000&runtime=node&base-image=node%3A20)

An MCP server template with OpenAI Apps SDK integration for ChatGPT-compatible widgets.

## Features

- **🤖 OpenAI Apps SDK**: Full compatibility with ChatGPT widgets
- **🎨 Official UI Components**: Integrated [OpenAI Apps SDK UI components](https://openai.github.io/apps-sdk-ui/) for consistent, accessible widgets
- **🛒 Ecommerce Widgets**: Complete ecommerce example with carousel, search, map, and order confirmation
- **🔄 Automatic Registration**: Widgets auto-register from `resources/` folder
- **📦 Props Schema**: Zod schema validation for widget props
- **🌙 Theme Support**: Dark/light theme detection via `useWidget` hook
- **🛠️ TypeScript**: Complete type safety
- **🔧 Widget Capabilities**: Full support for `callTool`, `sendFollowUpMessage`, and persistent state

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

## Project Structure

```
mcp-apps/
├── resources/                          # React widget components
│   ├── display-weather.tsx              # Weather widget example
│   ├── ecommerce-carousel.tsx           # Ecommerce product carousel
│   ├── product-search-result.tsx        # Product search with filters
│   ├── stores-locations-map.tsx         # Store locations map
│   └── order-confirmation.tsx           # Order confirmation widget
├── index.ts                             # Server entry point (includes brand info tool)
├── package.json
├── tsconfig.json
└── README.md
```

## How Automatic Registration Works

All React components in the `resources/` folder are automatically registered as MCP tools and resources when they export `widgetMetadata`:

```typescript
import { z } from 'zod';
import type { WidgetMetadata } from 'mcp-use/react';

const propSchema = z.object({
  city: z.string().describe('The city name'),
  temperature: z.number().describe('Temperature in Celsius'),
});

export const widgetMetadata: WidgetMetadata = {
  description: 'My widget description',
  props: propSchema,
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
  const { props, theme, isPending } = useWidget<MyProps>();

  // IMPORTANT: Widgets render before tool execution completes
  // Always check isPending to handle the loading state
  if (isPending) {
    return <div>Loading...</div>;
  }

  // Now props are safely available
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

> **Note**: Widgets render before the tool execution completes. On first render, `props` will be empty `{}` and `isPending` will be `true`. Always check `isPending` before accessing props. See the [Widget Lifecycle documentation](https://mcp-use.com/docs/typescript/server/widget-components/usewidget#widget-lifecycle) for more details.

### Defining Widget Metadata

Use Zod schemas to define widget inputs:

```typescript
import { z } from 'zod';
import type { WidgetMetadata } from 'mcp-use/react';

const propSchema = z.object({
  name: z.string().describe('Person name'),
  age: z.number().min(0).max(120).describe('Age in years'),
  email: z.string().email().describe('Email address'),
});

export const widgetMetadata: WidgetMetadata = {
  description: 'Display user information',
  props: propSchema,
};
```

### Theme Support

Automatically adapt to ChatGPT's theme:

```typescript
const { theme } = useWidget();

const bgColor = theme === 'dark' ? 'bg-gray-900' : 'bg-white';
const textColor = theme === 'dark' ? 'text-gray-100' : 'text-gray-800';
```

## Official UI Components

This template uses the [OpenAI Apps SDK UI component library](https://openai.github.io/apps-sdk-ui/) for building consistent, accessible widgets. The library provides:

- **Button**: Primary, secondary, and outline button variants
- **Card**: Container component for content sections
- **Carousel**: Image and content carousel with transitions
- **Input**: Form input fields
- **Icon**: Consistent iconography
- **Transition**: Smooth animations and transitions

Import components like this:

```typescript
import {
  Button,
  Card,
  Carousel,
  CarouselItem,
  Transition,
  Icon,
  Input,
} from '@openai/apps-sdk-ui';
```

## Ecommerce Widgets

This template includes a complete ecommerce example with four widgets:

### 1. Ecommerce Carousel (`ecommerce-carousel.tsx`)

A product carousel widget featuring:
- Title and description
- Carousel of product items with placeholder images
- Info button and Add to Cart button for each item
- Uses official Carousel, Card, Button, Icon, and Transition components
- Integrates with `callTool` for cart operations
- Persistent state management

### 2. Product Search Result (`product-search-result.tsx`)

A search results widget with:
- Search input with real-time filtering
- Price range filters and stock status filter
- Grid layout of product cards
- Uses `callTool` to perform searches
- Uses `sendFollowUpMessage` to update conversation
- Persistent filter state

### 3. Stores Locations Map (`stores-locations-map.tsx`)

A store locator widget featuring:
- Interactive map display (placeholder)
- List of store locations with details
- Distance calculation
- Get directions functionality
- Store details on click
- Uses `callTool` for directions and store info

### 4. Order Confirmation (`order-confirmation.tsx`)

An order confirmation widget with:
- Order summary and items list
- Shipping information
- Order status tracking
- Track order and view receipt actions
- Uses `callTool` for order tracking

## Brand Info Tool

The template includes a `get-brand-info` tool (normal MCP tool, not a widget) that returns brand information:

```typescript
// Call the tool
await client.callTool('get-brand-info', {});

// Returns brand details including:
// - Company name, tagline, description
// - Mission and values
// - Contact information
// - Social media links
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
import { useWidget, type WidgetMetadata } from 'mcp-use/react';

const propSchema = z.object({
  message: z.string().describe('Message to display'),
});

export const widgetMetadata: WidgetMetadata = {
  description: 'Display a message',
  props: propSchema,
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
import { text } from 'mcp-use/server';

server.tool({
  name: 'get-data',
  description: 'Fetch data from API',
  cb: async () => {
    return text('Data');
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

Moving from `starter` to `mcp-apps`:

```typescript
// Before: Manual props handling
const params = new URLSearchParams(window.location.search);
const city = params.get('city');

// After: Apps SDK hook
const { props } = useWidget();
const city = props.city;
```

## Using Widget Capabilities

The widgets in this template demonstrate the full capabilities of the Apps SDK:

### Calling Tools (`callTool`)

Widgets can call other MCP tools:

```typescript
const { callTool } = useWidget();

const handleAction = async () => {
  const result = await callTool('add-to-cart', {
    productId: '123',
    productName: 'Product Name',
    price: 29.99
  });
};
```

### Sending Follow-up Messages (`sendFollowUpMessage`)

Widgets can send messages to the ChatGPT conversation:

```typescript
const { sendFollowUpMessage } = useWidget();

await sendFollowUpMessage('Product added to cart successfully!');
```

### Persistent State (`setState`)

Widgets can maintain state across interactions:

```typescript
const { setState, state } = useWidget();

// Save state
await setState({ cart: [...cart, newItem] });

// Read state
const savedCart = state?.cart || [];
```

## Component Library Note

This template uses the [OpenAI Apps SDK UI component library](https://openai.github.io/apps-sdk-ui/). The exact component API may vary based on the library version. If you encounter import errors, check the [official documentation](https://openai.github.io/apps-sdk-ui/) for the correct component names and props.

If the official library is not available, you can replace the imports with custom React components or other UI libraries while maintaining the same widget structure.

## Learn More

- [OpenAI Apps SDK UI Components](https://openai.github.io/apps-sdk-ui/) - Official component library
- [MCP Documentation](https://modelcontextprotocol.io)
- [OpenAI Apps SDK](https://platform.openai.com/docs/apps)
- [mcp-use Documentation](https://mcp-use.com/docs)
- [React Documentation](https://react.dev/)
- [Zod Documentation](https://zod.dev/)

Happy building! 🚀

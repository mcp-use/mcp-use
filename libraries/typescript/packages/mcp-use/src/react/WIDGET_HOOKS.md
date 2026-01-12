# Widget Hooks for OpenAI Apps SDK

The `useWidget` hook provides a type-safe React adapter for the OpenAI Apps SDK `window.openai` API, making it easy to build MCP-use widgets that work seamlessly with ChatGPT's Apps SDK.

## Overview

The `useWidget` hook wraps the OpenAI Apps SDK's `window.openai` global API and provides:

- **Type-safe props access**: Automatically maps MCP UI props from `toolInput`
- **Reactive state management**: Subscribes to all OpenAI global changes
- **Layout awareness**: Access to theme, display mode, safe areas, etc.
- **Action methods**: Call tools, send messages, open external links, etc.

## Basic Usage

```tsx
import React from 'react';
import { useWidget } from 'mcp-use/react';

interface MyWidgetProps {
  title: string;
  count: number;
}

const MyWidget: React.FC = () => {
  const { props, theme, callTool } = useWidget<MyWidgetProps>();
  
  return (
    <div data-theme={theme}>
      <h1>{props.title}</h1>
      <p>Count: {props.count}</p>
    </div>
  );
};
```

## API Reference

### `useWidget<TProps, TOutput, TMetadata, TState>(defaultProps?)`

Main hook that provides access to all widget functionality.

**Type Parameters:**
- `TProps` - Type of your widget's input props
- `TOutput` - Type of the tool output
- `TMetadata` - Type of the tool response metadata
- `TState` - Type of the persisted widget state

**Returns:**
```typescript
{
  // Props and State
  props: TProps;                    // Widget input props (from toolInput)
  output: TOutput | null;           // Last tool execution output
  metadata: TMetadata | null;       // Tool response metadata
  state: TState | null;             // Persisted widget state
  setState: (state: TState) => Promise<void>;
  
  // Layout and Theme
  theme: 'light' | 'dark';          // Current theme
  displayMode: 'inline' | 'pip' | 'fullscreen';
  safeArea: SafeArea;               // Safe area insets
  maxHeight: number;                // Maximum available height
  userAgent: UserAgent;             // Device and capabilities info
  locale: string;                   // Current locale
  
  // Actions
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResponse>;
  sendFollowUpMessage: (prompt: string) => Promise<void>;
  openExternal: (href: string) => void;
  requestDisplayMode: (mode: DisplayMode) => Promise<{ mode: DisplayMode }>;
  
  // Availability
  isAvailable: boolean;             // Whether window.openai is available
}
```

### Helper Hooks

#### `useWidgetProps<TProps>(defaultProps?)`

Simplified hook for getting just the widget props.

```tsx
import { useWidgetProps } from 'mcp-use/react';

const MyWidget: React.FC = () => {
  const props = useWidgetProps<{ city: string; temperature: number }>();
  return <div>{props.city}: {props.temperature}°</div>;
};
```

#### `useWidgetTheme()`

Get the current theme value.

```tsx
import { useWidgetTheme } from 'mcp-use/react';

const MyWidget: React.FC = () => {
  const theme = useWidgetTheme();
  return <div className={theme === 'dark' ? 'dark-mode' : 'light-mode'}>...</div>;
};
```

#### `useWidgetState<TState>(defaultState?)`

Manage persisted widget state (similar to `useState` but persisted).

```tsx
import { useWidgetState } from 'mcp-use/react';

const MyWidget: React.FC = () => {
  const [favorites, setFavorites] = useWidgetState<string[]>([]);
  
  const addFavorite = async (item: string) => {
    await setFavorites(prev => [...(prev || []), item]);
  };
  
  return <div>Favorites: {favorites?.length || 0}</div>;
};
```

## Complete Example: Weather Widget

```tsx
import React from 'react';
import { z } from 'zod';
import { useWidget, type WidgetMetadata } from 'mcp-use/react';

const propSchema = z.object({
  city: z.string().describe('The city to display weather for'),
  weather: z.enum(['sunny', 'rain', 'snow', 'cloudy']),
  temperature: z.number().min(-20).max(50),
});

export const widgetMetadata: WidgetMetadata = {
  description: 'Display weather for a city',
  props: propSchema,
}

type WeatherProps = z.infer<typeof propSchema>;

const WeatherWidget: React.FC = () => {
  const { props, theme, sendFollowUpMessage } = useWidget<WeatherProps>();
  const { city, weather, temperature } = props;
  
  // Theme-aware styling
  const bgColor = theme === 'dark' ? 'bg-gray-900' : 'bg-white';
  const textColor = theme === 'dark' ? 'text-gray-100' : 'text-gray-800';
  
  const askForForecast = async () => {
    await sendFollowUpMessage(`What's the 7-day forecast for ${city}?`);
  };
  
  return (
    <div className={`${bgColor} ${textColor} rounded-xl shadow-lg p-6`}>
      <h2 className="text-2xl font-bold mb-2">{city}</h2>
      <div className="flex items-center space-x-4">
        <span className="text-4xl">{temperature}°</span>
        <p className="text-lg capitalize">{weather}</p>
      </div>
      <button 
        onClick={askForForecast}
        className="mt-4 px-4 py-2 bg-blue-500 text-white rounded"
      >
        Get 7-Day Forecast
      </button>
    </div>
  );
};

export default WeatherWidget;
```

## Advanced Usage

### Calling Tools Directly

```tsx
const MyWidget: React.FC = () => {
  const { callTool } = useWidget();
  
  const refreshData = async () => {
    const result = await callTool('refresh_data', { city: 'San Francisco' });
    console.log('Refreshed:', result);
  };
  
  return <button onClick={refreshData}>Refresh</button>;
};
```

### Managing Widget State

Widget state is persisted across sessions and shown to the model:

```tsx
const PizzaWidget: React.FC = () => {
  const [favorites, setFavorites] = useWidgetState<string[]>([]);
  
  const toggleFavorite = async (id: string) => {
    await setFavorites(prev => {
      const current = prev || [];
      return current.includes(id)
        ? current.filter(item => item !== id)
        : [...current, id];
    });
  };
  
  return (
    <div>
      {/* Your UI */}
    </div>
  );
};
```

### Request Different Display Modes

```tsx
const MapWidget: React.FC = () => {
  const { requestDisplayMode } = useWidget();
  
  const goFullscreen = async () => {
    const result = await requestDisplayMode('fullscreen');
    console.log('Display mode:', result.mode);
  };
  
  return <button onClick={goFullscreen}>Go Fullscreen</button>;
};
```

### Open External Links

```tsx
const MyWidget: React.FC = () => {
  const { openExternal } = useWidget();
  
  return (
    <button onClick={() => openExternal('https://example.com')}>
      Open Website
    </button>
  );
};
```

## Type Safety

The hook provides full TypeScript support:

```tsx
interface WeatherProps {
  city: string;
  temperature: number;
  conditions: 'sunny' | 'cloudy' | 'rainy';
}

interface WeatherOutput {
  forecast: string[];
  alerts: string[];
}

interface WeatherState {
  favoriteLocations: string[];
  unit: 'celsius' | 'fahrenheit';
}

const WeatherWidget: React.FC = () => {
  const {
    props,      // Type: WeatherProps
    output,     // Type: WeatherOutput | null
    state,      // Type: WeatherState | null
    setState,   // Type: (state: WeatherState) => Promise<void>
  } = useWidget<WeatherProps, WeatherOutput, unknown, WeatherState>();
  
  // All properties are fully typed!
  const { city, temperature, conditions } = props;
  const forecast = output?.forecast;
  const favorites = state?.favoriteLocations || [];
};
```

## Best Practices

1. **Always provide default props** when possible:
   ```tsx
   const { props } = useWidget<MyProps>({ title: 'Default', count: 0 });
   ```

2. **Use helper hooks** for simpler use cases:
   ```tsx
   // Instead of:
   const { props } = useWidget<MyProps>();
   
   // Use:
   const props = useWidgetProps<MyProps>();
   ```

3. **Keep widget state small**: Widget state is shown to the model, so keep it under 4k tokens for best performance.

4. **Handle theme changes**: Always adapt your UI to the `theme` value:
   ```tsx
   const { theme } = useWidget();
   const bgColor = theme === 'dark' ? 'bg-gray-900' : 'bg-white';
   ```

5. **Check availability**: For SSR or testing, check if the API is available:
   ```tsx
   const { isAvailable, callTool } = useWidget();
   
   if (!isAvailable) {
     return <div>Widget API not available</div>;
   }
   ```

## Integration with MCP-use

The `useWidget` hook is designed to work seamlessly with MCP-use's widget system:

1. **Props are automatically mapped** from MCP's `toolInput` to the OpenAI Apps SDK format
2. **Widget metadata** (`widgetMetadata` export) defines the input schema
3. **Build system** handles bundling and deployment
4. **Type safety** is maintained throughout the entire stack

See the [MCP-use documentation](https://mcp-use.github.io) for more information on building and deploying widgets.


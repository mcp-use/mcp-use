# useCallTool Widget Example

This example demonstrates how to use the `useCallTool` hook in an OpenAI Apps SDK widget context.

## Features

- ✅ Type-safe tool calling with generic types `<TInput, TOutput>`
- ✅ React Query-style loading states (`isPending`, `isSuccess`, `isError`, `isIdle`)
- ✅ Two calling patterns: fire-and-forget (`callTool`) and async/await (`callToolAsync`)
- ✅ Lifecycle callbacks (`onSuccess`, `onError`, `onSettled`)
- ✅ Automatic context detection (uses `window.openai.callTool`)
- ✅ Search history tracking
- ✅ Error handling and display

## How It Works

The `useCallTool` hook automatically detects that it's running in a widget context (OpenAI Apps SDK) and uses `window.openai.callTool` under the hood.

### Basic Usage

```typescript
import { useCallTool } from "mcp-use/react";

// Define your types
type WeatherInput = { city: string };
type WeatherOutput = { temperature: number; conditions: string };

// Create the hook
const { callTool, callToolAsync, isPending, data, error } = useCallTool<
  WeatherInput,
  WeatherOutput
>(
  "get-weather",  // Tool name
  {
    onSuccess: (data) => console.log("Success:", data),
    onError: (error) => console.error("Error:", error),
  }
);

// Pattern 1: Fire-and-forget with callbacks
callTool({ city: "Paris" });

// Pattern 2: Async/await for explicit control
const result = await callToolAsync({ city: "Paris" });
```

## Key Components

### State Management

The hook provides React Query-style state flags:

- `isIdle` - No tool call has been made yet
- `isPending` - Tool call is in progress
- `isSuccess` - Tool call completed successfully
- `isError` - Tool call failed
- `data` - The successful response data
- `error` - The error if the call failed

### Lifecycle Callbacks

- `onSuccess(data, input)` - Called when the tool call succeeds
- `onError(error, input)` - Called when the tool call fails
- `onSettled(data, error, input)` - Called after completion (success or error)

### Methods

- `callTool(args)` - Fire-and-forget pattern, uses callbacks
- `callToolAsync(args)` - Returns a Promise, allows async/await
- `reset()` - Reset state back to idle

## Running This Example

This widget can be registered with your MCP server and displayed in OpenAI Apps SDK compatible clients.

See the main server example for how to register this widget.

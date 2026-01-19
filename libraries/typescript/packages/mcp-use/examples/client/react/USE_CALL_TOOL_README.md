# useCallTool React Client Example

This example demonstrates how to use the `useCallTool` hook with an MCP client in a React application.

## Features

- ✅ **Type-safe tool calling** with autocomplete for tool names
- ✅ **Pass server object directly** - `useCallTool(server, 'tool-name')`
- ✅ React Query-style loading states (`isPending`, `isSuccess`, `isError`, `isIdle`)
- ✅ Two calling patterns: fire-and-forget (`callTool`) and async/await (`callToolAsync`)
- ✅ Lifecycle callbacks (`onSuccess`, `onError`, `onSettled`)
- ✅ Configurable timeout options for MCP calls
- ✅ Automatic context detection (widget vs MCP client)
- ✅ Error handling and display
- ✅ Multiple tool coordination

## How It Works

The `useCallTool` hook accepts the server object directly and automatically calls the appropriate method.

### Option 1: Type-Safe with Tool Registry (Recommended)

```typescript
import { useMcp, useCallTool, type TypedMcpServer } from "mcp-use/react";

// Define your tool registry for autocomplete
type MyTools = {
  "get-weather": {
    input: { city: string };
    output: { temperature: number; conditions: string };
  };
  "send-email": {
    input: { to: string; subject: string };
    output: { sent: boolean };
  };
};

function MyComponent() {
  const mcp = useMcp({ url: "http://localhost:3000/mcp" });

  // Cast to typed server for autocomplete
  const typedServer = mcp as TypedMcpServer<MyTools>;

  // Tool names autocomplete! 🎉
  const { callTool, isPending, data } = useCallTool(typedServer, "get-weather");

  return (
    <button onClick={() => callTool({ city: "Paris" })}>
      Get Weather
    </button>
  );
}
```

### Option 2: Simple Usage (Pass Server Directly)

```typescript
import { useMcp, useCallTool } from "mcp-use/react";

// 1. Connect to MCP server
const mcp = useMcp({
  url: "http://localhost:3000/mcp",
});

// 2. Define your types
type WeatherInput = { city: string };
type WeatherOutput = { temperature: number; conditions: string };

// 3. Create the hook - pass server directly!
const { callTool, callToolAsync, isPending, data, error } = useCallTool<
  WeatherInput,
  WeatherOutput
>(
  mcp, // Pass the server object directly
  "get-weather", // Tool name
  {
    timeout: 30000, // 30 second timeout (optional)
    onSuccess: (data) => console.log("Success:", data),
    onError: (error) => console.error("Error:", error),
  }
);

// Pattern 1: Fire-and-forget with callbacks
callTool({ city: "Paris" });

// Pattern 2: Async/await for explicit control
const result = await callToolAsync({ city: "Paris" });
console.log(result.temperature);
```

## Key Features

### State Management

The hook provides React Query-style state flags:

- `isIdle` - No tool call has been made yet
- `isPending` - Tool call is in progress
- `isSuccess` - Tool call completed successfully
- `isError` - Tool call failed
- `data` - The successful response data (typed as `TOutput`)
- `error` - The error if the call failed

### Lifecycle Callbacks

- `onSuccess(data, input)` - Called when the tool call succeeds
- `onError(error, input)` - Called when the tool call fails
- `onSettled(data, error, input)` - Called after completion (success or error)

### Timeout Options (MCP Client Only)

- `timeout` - Timeout in milliseconds (default: 60000)
- `maxTotalTimeout` - Maximum total timeout even with progress resets
- `resetTimeoutOnProgress` - Reset timeout when progress notifications are received

### Methods

- `callTool(args)` - Fire-and-forget pattern, uses callbacks
- `callToolAsync(args)` - Returns a Promise, allows async/await
- `reset()` - Reset state back to idle

## Running This Example

1. Start an MCP server on `http://localhost:3000/mcp`
2. Run the React example:

```bash
cd examples/client/react
npm install
npm run dev
```

3. Open http://localhost:5173 in your browser
4. Navigate to the "useCallTool Example" section

## Coordinating Multiple Tools

You can create multiple `useCallTool` hooks to call different tools:

```typescript
const weatherHook = useCallTool<WeatherInput, WeatherOutput>(
  mcp,
  "get-weather"
);

const emailHook = useCallTool<EmailInput, EmailOutput>(mcp, "send-email");

// Chain them together
const handleSendWeatherEmail = async () => {
  const weather = await weatherHook.callToolAsync({ city: "Paris" });
  const email = await emailHook.callToolAsync({
    to: "user@example.com",
    body: `Temperature: ${weather.temperature}°C`,
  });
};
```

## Type Safety

The hook uses TypeScript generics to provide full type safety:

```typescript
// Option 1: Define tool registry for autocomplete
type MyTools = {
  "get-weather": {
    input: { city: string; units?: "celsius" | "fahrenheit" };
    output: { temperature: number; conditions: string };
  };
};

const typedServer = mcp as TypedMcpServer<MyTools>;
const hook = useCallTool(typedServer, "get-weather"); // autocompletes!

// Option 2: Manual type parameters
type Input = { city: string; units?: "celsius" | "fahrenheit" };
type Output = { temperature: number; conditions: string };

const hook = useCallTool<Input, Output>(mcp, "get-weather");

// TypeScript will enforce correct types
hook.callTool({ city: "Paris" }); // ✅ Valid
hook.callTool({ name: "Paris" }); // ❌ Type error

// Response is typed
hook.data?.temperature; // ✅ number
hook.data?.invalid; // ❌ Type error
```

## Error Handling

Errors are automatically caught and made available through the `error` state:

```typescript
const hook = useCallTool<Input, Output>(mcp, "get-weather", {
  onError: (error, input) => {
    console.error(`Failed to get weather for ${input.city}:`, error.message);
    // Show toast notification, log to analytics, etc.
  },
});

// Or handle errors manually with async/await
try {
  const result = await hook.callToolAsync({ city: "Paris" });
} catch (error) {
  console.error("Error:", error);
}
```

## Using with McpClientProvider (Multi-Server)

When managing multiple MCP servers with `McpClientProvider`, you can use `useCallTool` with individual server connections:

```typescript
import {
  McpClientProvider,
  useMcpClient,
  useMcpServer,
  useCallTool,
  type TypedMcpServer,
} from "mcp-use/react";

// 1. Define your tool registries
type LinearTools = {
  "create-issue": { input: { title: string }; output: { id: string } };
};

type VercelTools = {
  "deploy": { input: { project: string }; output: { url: string } };
};

// 2. Wrap your app with McpClientProvider
function App() {
  return (
    <McpClientProvider>
      <YourComponent />
    </McpClientProvider>
  );
}

// 3. Add servers and use them in your components
function YourComponent() {
  const { addServer } = useMcpClient();

  // Add multiple servers
  useEffect(() => {
    addServer("linear", { url: "https://mcp.linear.app/mcp" });
    addServer("vercel", { url: "https://mcp.vercel.com" });
  }, [addServer]);

  // Get specific server and cast to typed
  const linearServer = useMcpServer("linear") as TypedMcpServer<LinearTools>;
  const vercelServer = useMcpServer("vercel") as TypedMcpServer<VercelTools>;

  // Use useCallTool with typed servers - tool names autocomplete!
  const createIssue = useCallTool(linearServer, "create-issue");
  const deploy = useCallTool(vercelServer, "deploy");

  // Call the tools
  const handleCreate = async () => {
    const issue = await createIssue.callToolAsync({ title: "Bug" });
    console.log("Created issue:", issue.id);
  };
}
```

### Benefits of McpClientProvider:

- ✅ **Multiple Servers** - Connect to multiple MCP servers simultaneously
- ✅ **Type-Safe** - Cast servers for tool name autocomplete
- ✅ **Isolated State** - Each server has its own connection, tools, and state
- ✅ **Dynamic Management** - Add/remove servers at runtime
- ✅ **Per-Server Tools** - Call tools from specific servers using `useMcpServer(id)`
- ✅ **Notification Management** - Handle notifications from multiple servers
- ✅ **Same API** - `useCallTool` works identically with both approaches

See `use-call-tool-multi-server-example.tsx` for a complete working example.

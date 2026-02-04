# Components API Reference

React components provided by mcp-use for ChatGPT widgets.

## Table of Contents

- [McpUseProvider](#mcpuseprovider)
- [Image](#image)
- [ErrorBoundary](#errorboundary)
- [useWidget Hook](#usewidget-hook)

## McpUseProvider

Unified provider combining all common setup. Wrap your widget content:

```tsx
import { McpUseProvider } from "mcp-use/react";

function MyWidget() {
  return (
    <McpUseProvider
      autoSize          // Auto-resize widget to content
      viewControls      // Add debug/fullscreen buttons
      debug             // Show debug info
    >
      <div>Widget content</div>
    </McpUseProvider>
  );
}
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `autoSize` | boolean | false | Auto-resize widget height to content |
| `viewControls` | boolean | false | Show debug/fullscreen control buttons |
| `debug` | boolean | false | Display debug information overlay |
| `children` | ReactNode | required | Widget content |

### What It Includes

- `StrictMode` - React strict mode
- `ThemeProvider` - Theme context (light/dark)
- `BrowserRouter` - React Router support
- `WidgetControls` - Optional debug controls
- `ErrorBoundary` - Graceful error handling

## Image

Handles both data URLs and public paths:

```tsx
import { Image } from "mcp-use/react";

function MyWidget() {
  return (
    <div>
      {/* From public/ folder */}
      <Image src="/images/photo.jpg" alt="Photo" />

      {/* Data URL */}
      <Image src="data:image/png;base64,..." alt="Base64 image" />

      {/* With styling */}
      <Image
        src="/icons/logo.svg"
        alt="Logo"
        className="w-16 h-16"
        style={{ borderRadius: '8px' }}
      />
    </div>
  );
}
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `src` | string | Image path (relative to public/) or data URL |
| `alt` | string | Alt text for accessibility |
| `className` | string | CSS classes |
| `style` | CSSProperties | Inline styles |
| ...rest | ImgHTMLAttributes | All standard img attributes |

### Alternative: window.__getFile__

For non-Image elements or dynamic paths:

```tsx
function MyWidget() {
  const bannerUrl = window.__getFile__?.("images/banner.png");

  return (
    <div style={{ backgroundImage: `url(${bannerUrl})` }}>
      Content with background
    </div>
  );
}
```

## ErrorBoundary

Graceful error handling for widgets:

```tsx
import { ErrorBoundary } from "mcp-use/react";

function MyWidget() {
  return (
    <ErrorBoundary
      fallback={<div className="error">Something went wrong</div>}
      onError={(error, errorInfo) => {
        console.error("Widget error:", error);
        // Optional: send to error tracking service
      }}
    >
      <RiskyComponent />
    </ErrorBoundary>
  );
}
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `fallback` | ReactNode | UI to show when error occurs |
| `onError` | (error, errorInfo) => void | Callback when error is caught |
| `children` | ReactNode | Components that might throw |

### Custom Fallback with Reset

```tsx
function ErrorFallback({ error, reset }) {
  return (
    <div className="p-4 bg-red-100 rounded">
      <h3>Error occurred</h3>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}

function MyWidget() {
  return (
    <ErrorBoundary fallback={ErrorFallback}>
      <MyComponent />
    </ErrorBoundary>
  );
}
```

## useWidget Hook

Complete hook API reference:

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

  // Response metadata
  metadata,
} = useWidget<PropsType, OutputType>();
```

### Return Values

| Value | Type | Description |
|-------|------|-------------|
| `props` | PropsType | Widget input from tool call (empty `{}` while pending) |
| `isPending` | boolean | True while tool is still executing |
| `state` | any | Persisted widget state (survives re-renders) |
| `setState` | (state \| updater) => Promise | Update persistent state |
| `theme` | 'light' \| 'dark' | Current theme from host |
| `callTool` | (name, args) => Promise | Call another MCP tool |
| `displayMode` | 'inline' \| 'pip' \| 'fullscreen' | Current display mode |
| `requestDisplayMode` | (mode) => Promise | Request display mode change |
| `output` | OutputType | Additional output from tool |
| `metadata` | object | Response metadata |

### setState Usage

```tsx
// Object form
await setState({ count: 5, items: ['a', 'b'] });

// Updater function form
await setState((prev) => ({
  ...prev,
  count: (prev?.count || 0) + 1,
}));
```

### callTool Usage

```tsx
const handleRefresh = async () => {
  try {
    const result = await callTool("fetch-data", { id: "123" });
    console.log("Result:", result.content);

    // Check for errors
    if (result.isError) {
      console.error("Tool returned error");
    }
  } catch (error) {
    console.error("Tool call failed:", error);
  }
};
```

### requestDisplayMode Usage

```tsx
const goFullscreen = async () => {
  await requestDisplayMode("fullscreen");
};

const exitFullscreen = async () => {
  await requestDisplayMode("inline");
};

// Check current mode
if (displayMode === "fullscreen") {
  // Show exit button
}
```

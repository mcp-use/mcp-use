# MCP Apps Example - Dual-Protocol Widget Support

This example demonstrates the new **MCP Apps Extension (SEP-1865)** support in mcp-use, enabling widgets that work with **both ChatGPT and MCP Apps-compatible clients** from a single codebase.

## Features

- ✅ **Dual-protocol support**: Widgets work with ChatGPT (Apps SDK) and MCP Apps clients
- ✅ **Automatic adaptation**: Server generates metadata for both protocols
- ✅ **Unified CSP config**: Single configuration transforms to both snake_case and camelCase
- ✅ **Backward compatible**: Existing Apps SDK widgets continue working unchanged

## What's New

### The `mcpApps` Widget Type

```typescript
server.uiResource({
  type: "mcpApps", // NEW! Dual-protocol support
  name: "weather-display",
  htmlTemplate: `<html>...</html>`,
  metadata: {
    csp: {
      connectDomains: ["https://api.weather.com"],
      resourceDomains: ["https://cdn.weather.com"],
    },
    prefersBorder: true,
    autoResize: true, // MCP Apps specific
    widgetDescription: "...", // ChatGPT specific
  },
});
```

This single definition generates metadata for **both protocols**:

#### For ChatGPT (Apps SDK)
```typescript
{
  mimeType: "text/html+skybridge",
  _meta: {
    "openai/outputTemplate": "ui://widget/weather-display.html",
    "openai/widgetCSP": {
      connect_domains: ["https://api.weather.com"],
      resource_domains: ["https://cdn.weather.com"]
    },
    "openai/widgetPrefersBorder": true,
    "openai/widgetDescription": "..."
  }
}
```

#### For MCP Apps Clients
```typescript
{
  mimeType: "text/html;profile=mcp-app",
  _meta: {
    ui: {
      resourceUri: "ui://widget/weather-display.html",
      csp: {
        connectDomains: ["https://api.weather.com"],
        resourceDomains: ["https://cdn.weather.com"]
      },
      prefersBorder: true,
      autoResize: true
    },
    "ui/resourceUri": "ui://widget/weather-display.html" // Legacy compatibility
  }
}
```

## Running the Example

```bash
# Install dependencies
npm install

# Run the server
npm run example:server:mcp-apps
```

## Testing with Different Clients

### ChatGPT
The widgets will work with ChatGPT using the Apps SDK protocol (text/html+skybridge).

### MCP Apps Clients
The same widgets will work with MCP Apps-compatible clients like:
- Claude Desktop (upcoming MCP Apps support)
- Goose
- Other MCP Apps Extension-compatible clients

## Key Examples in This Server

1. **Weather Display** - Dual-protocol widget with custom tool
   - Shows how to use the `mcpApps` type
   - Demonstrates unified CSP configuration
   - Works with both ChatGPT and MCP Apps clients

2. **Greeting Display** - Auto-exposed dual-protocol widget
   - Automatically registers as a tool
   - Shows props-based widget configuration
   - Demonstrates protocol-agnostic widget code

3. **Info Tool** - Returns structured data about the feature
   - Explains the dual-protocol support
   - Lists benefits and supported protocols

## Migration from Apps SDK

If you have existing Apps SDK widgets, you have two options:

### Option 1: Keep using `appsSdk` (ChatGPT only)
```typescript
server.uiResource({
  type: "appsSdk", // ChatGPT only
  name: "my-widget",
  htmlTemplate: `...`,
  appsSdkMetadata: {
    "openai/widgetCSP": {
      connect_domains: ["https://api.example.com"],
      resource_domains: ["https://cdn.example.com"],
    },
    "openai/widgetPrefersBorder": true,
  },
});
```

### Option 2: Migrate to `mcpApps` (Universal)
```typescript
server.uiResource({
  type: "mcpApps", // Works with ChatGPT AND MCP Apps clients
  name: "my-widget",
  htmlTemplate: `...`,
  metadata: {
    // Unified config (note: camelCase, no openai/ prefix)
    csp: {
      connectDomains: ["https://api.example.com"],
      resourceDomains: ["https://cdn.example.com"],
    },
    prefersBorder: true,
    widgetDescription: "...", // Optional ChatGPT-specific
    autoResize: true, // Optional MCP Apps-specific
  },
});
```

**Key changes when migrating:**
- `appsSdkMetadata` → `metadata`
- `"openai/widgetCSP"` → `csp`
- `connect_domains` → `connectDomains` (snake_case → camelCase)
- `resource_domains` → `resourceDomains`

## Benefits

1. **Single Codebase**: Write your widget once, works with multiple clients
2. **Backward Compatible**: Existing Apps SDK widgets continue working
3. **Future-Proof**: Based on official MCP Apps Extension (SEP-1865)
4. **Standards-Based**: Uses official `@modelcontextprotocol/ext-apps` SDK
5. **Gradual Migration**: Migrate widgets at your own pace

## Learn More

- [MCP Apps Extension (SEP-1865)](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/)
- [Official MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps)
- [ChatGPT Apps SDK](https://developers.openai.com/apps-sdk)

# Icons and Website URL Example

This example demonstrates the SEP-973 icons and website URL features in mcp-use. It shows how to add icons to your server, tools, resources, and prompts, as well as how to add a website URL to your server configuration.

## Features Demonstrated

- ✅ **Server-level icons and website URL** - Displayed in the Inspector's server capabilities modal
- ✅ **Tool-level icons** - Custom icons for individual tools
- ✅ **Resource-level icons** - Custom icons for resources
- ✅ **Prompt-level icons** - Custom icons for prompts
- ✅ **Multiple icon sizes** - Using the `sizes` field for different display contexts
- ✅ **Data URI icons** - Base64-encoded icons embedded directly in the code

## Getting Started

### Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

This will start:
- MCP server on port 3000
- MCP Inspector at http://localhost:3000/inspector

### Production

```bash
# Build the server
pnpm build

# Run the built server
pnpm start
```

## Usage

Once the server is running, open the Inspector at http://localhost:3000/inspector to see:

1. **Server Icon and Website URL**: Click on the server info button to see the server's icon and a clickable website link
2. **Tool Icons**: Each tool (weather, calculator) displays its custom icon
3. **Resource Icons**: Each resource (documentation, config) displays its custom icon
4. **Prompt Icons**: The code-review prompt displays its custom icon

## Icon Formats Supported

### URL-based Icons
```typescript
icons: [
  {
    src: "https://mcp-use.com/logo.png",
    mimeType: "image/png",
    sizes: "48x48",
  },
]
```

### Data URI Icons
```typescript
icons: [
  {
    src: "data:image/png;base64,iVBORw0KGgo...",
    mimeType: "image/png",
    sizes: "1x1",
  },
]
```

### Multiple Sizes
```typescript
icons: [
  {
    src: "https://mcp-use.com/logo.png",
    mimeType: "image/png",
    sizes: "16x16 32x32 48x48", // Multiple sizes
  },
]
```

## API Reference

### Server Configuration

```typescript
createMCPServer("server-name", {
  version: "1.0.0",
  description: "Server description",
  icons: [
    {
      src: "https://example.com/icon.png",
      mimeType: "image/png",
      sizes: "512x512",
    },
  ],
  websiteUrl: "https://example.com",
});
```

### Tool with Icon

```typescript
server.tool({
  name: "tool-name",
  title: "Tool Title",
  description: "Tool description",
  icons: [
    {
      src: "https://example.com/tool-icon.png",
      mimeType: "image/png",
      sizes: "48x48",
    },
  ],
  // ... rest of tool definition
});
```

### Resource with Icon

```typescript
server.resource({
  name: "resource-name",
  uri: "resource://resource-name",
  icons: [
    {
      src: "https://example.com/resource-icon.png",
      mimeType: "image/png",
      sizes: "32x32",
    },
  ],
  // ... rest of resource definition
});
```

### Prompt with Icon

```typescript
server.prompt({
  name: "prompt-name",
  title: "Prompt Title",
  description: "Prompt description",
  icons: [
    {
      src: "https://example.com/prompt-icon.png",
      mimeType: "image/png",
      sizes: "48x48",
    },
  ],
  // ... rest of prompt definition
});
```

## Security Considerations

⚠️ **Important**: When using URL-based icons, ensure that:
- URLs are from trusted domains
- HTTPS is used for external URLs
- SVG icons are validated (they can contain executable JavaScript)

The Inspector automatically handles security by:
- Using `rel="noopener noreferrer"` for external links
- Validating icon sources
- Providing fallback icons when icons fail to load

## Learn More

- [SEP-973 Specification](https://github.com/modelcontextprotocol/specification/blob/main/SEPs/sep-973-icons-and-website-url.md)
- [MCP Documentation](https://modelcontextprotocol.io)
- [mcp-use Documentation](https://docs.mcp-use.io)

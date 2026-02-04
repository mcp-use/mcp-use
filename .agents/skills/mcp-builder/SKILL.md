---
name: mcp-builder
description: Build Model Context Protocol (MCP) servers with mcp-use framework. Use when creating MCP servers, defining tools/resources/prompts, working with mcp-use, bootstrapping MCP projects, deploying MCP servers, or when user mentions MCP development, MCP tools, MCP resources, or MCP prompts.
---

# MCP Server Builder

Build production-ready MCP servers with the mcp-use framework. This Skill provides quick-start instructions and best practices for creating MCP servers.

## Quick Start

**Always bootstrap with `npx create-mcp-use-app`:**

```bash
npx create-mcp-use-app my-mcp-server
cd my-mcp-server
```

**Choose template based on needs:**
- `--template starter` - Full-featured with all MCP primitives (tools, resources, prompts) + example widgets
- `--template mcp-apps` - Optimized for ChatGPT widgets with product search example
- `--template blank` - Minimal starting point for custom implementation

```bash
# Example: MCP Apps template
npx create-mcp-use-app my-server --template mcp-apps
cd my-server
yarn install
```

**Template Details:**
- **starter**: Best for learning - includes all MCP features plus widgets
- **mcp-apps**: Best for ChatGPT apps - includes product carousel/accordion example
- **blank**: Best for experts - minimal boilerplate

## MCP Apps Structure

### Automatic Widget Registration

The mcp-apps and starter templates automatically discover and register React widgets from the `resources/` folder:

**Single-file widget pattern:**
```
resources/
└── weather-display.tsx  # Widget name becomes "weather-display"
```

**Folder-based widget pattern:**
```
resources/
└── product-search/      # Widget name becomes "product-search"
    ├── widget.tsx       # Entry point (required name!)
    ├── components/      # Sub-components
    ├── hooks/           # Custom hooks
    ├── types.ts
    └── constants.ts
```

**What happens automatically:**
1. Server scans `resources/` folder at startup
2. Finds `.tsx` files or `widget.tsx` in folders
3. Extracts `widgetMetadata` from each component
4. Registers as MCP Tool (e.g., `weather-display`)
5. Registers as MCP Resource (e.g., `ui://widget/weather-display.html`)
6. Builds widget bundles with Vite

**No manual registration needed!** Just export `widgetMetadata` and a default component.

## Defining Tools

Tools are executable functions that AI models can call:

```typescript
import { MCPServer, text, object } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  description: "My MCP server"
});

// Simple tool
server.tool(
  {
    name: "greet-user",
    description: "Greet a user by name",
    schema: z.object({
      name: z.string().describe("The user's name"),
      formal: z.boolean().optional().describe("Use formal greeting")
    })
  },
  async ({ name, formal }) => {
    const greeting = formal ? `Good day, ${name}` : `Hey ${name}!`;
    return text(greeting);
  }
);
```

**Key points:**
- Use Zod for schema validation
- Add `.describe()` to all parameters
- Return appropriate response types (text, object, widget)

## Defining Resources

Resources expose data that clients can read:

```typescript
import { object, text, markdown } from "mcp-use/server";

// Static resource
server.resource(
  {
    uri: "config://settings",
    name: "Application Settings",
    description: "Current configuration",
    mimeType: "application/json"
  },
  async () => {
    return object({
      theme: "dark",
      version: "1.0.0"
    });
  }
);

// Dynamic resource
server.resource(
  {
    uri: "stats://current",
    name: "Current Stats",
    description: "Real-time statistics",
    mimeType: "application/json"
  },
  async () => {
    const stats = await getStats();
    return object(stats);
  }
);

// Markdown resource
server.resource(
  {
    uri: "docs://guide",
    name: "User Guide",
    description: "Documentation",
    mimeType: "text/markdown"
  },
  async () => {
    return markdown("# Guide\n\nWelcome!");
  }
);
```

**Response helpers available:**
- `text(string)` - Plain text
- `object(data)` - JSON objects
- `markdown(string)` - Markdown content
- `html(string)` - HTML content
- `image(buffer, mimeType)` - Binary images
- `audio(buffer, mimeType)` - Audio files
- `binary(buffer, mimeType)` - Binary data
- `mix(...contents)` - Combine multiple content types

**Advanced response examples:**

```typescript
// Audio response
import { audio } from 'mcp-use/server';

// From base64 data
return audio(base64Data, "audio/wav");

// From file path (async)
return await audio("/path/to/audio.mp3");

// Binary data (PDFs, etc.)
import { binary } from 'mcp-use/server';
return binary(pdfBuffer, "application/pdf");

// Mix multiple content types
import { mix, text, object, resource } from 'mcp-use/server';
return mix(
  text("Analysis complete:"),
  object({ score: 95, status: "pass" }),
  resource("report://analysis-123", text("Full report..."))
);
```

## Defining Prompts

Prompts are reusable templates for AI interactions:

```typescript
server.prompt(
  {
    name: "code-review",
    description: "Generate a code review template",
    schema: z.object({
      language: z.string().describe("Programming language"),
      focusArea: z.string().optional().describe("Specific focus area")
    })
  },
  async ({ language, focusArea }) => {
    const focus = focusArea ? ` with focus on ${focusArea}` : "";
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please review this ${language} code${focus}.`
          }
        }
      ]
    };
  }
);
```

## Testing Locally

**Development mode (hot reload):**
```bash
yarn dev
```

**Production mode:**
```bash
yarn build
yarn start
```

**Inspector UI:**
Access at `http://localhost:3000/inspector` to test tools, view resources, and try prompts.

**Tunneling (test with ChatGPT before deploying):**

Option 1 - Auto-tunnel:
```bash
mcp-use start --port 3000 --tunnel
```

Option 2 - Separate tunnel:
```bash
yarn start  # Terminal 1
npx @mcp-use/tunnel 3000  # Terminal 2
```

You'll get a public URL like `https://happy-cat.local.mcp-use.run/mcp`

**Tunnel details:**
- Expires after 24 hours
- Closes after 1 hour of inactivity
- Rate limit: 10 creations/hour, max 5 active per IP

Learn more: https://mcp-use.com/docs/tunneling

## Deployment

**Deploy to mcp-use Cloud (recommended):**

```bash
# Login first (if not already)
npx mcp-use login

# Deploy
yarn deploy
```

**If authentication error:**
```bash
npx mcp-use login
yarn deploy
```

**After deployment:**
- Public URL provided (e.g., `https://your-server.mcp-use.com/mcp`)
- Auto-scaled and monitored
- HTTPS enabled
- Zero-downtime deployments

## Best Practices

**Tool Design:**
- One tool = one focused capability
- Descriptive names and descriptions
- Use `.describe()` on all Zod fields
- Handle errors gracefully
- Return helpful error messages

**Resource Design:**
- Use clear URI schemes (config://, docs://, stats://)
- Choose appropriate MIME types
- Use response helpers for cleaner code
- Make resources dynamic when needed

**Prompt Design:**
- Keep prompts reusable
- Use system messages for context
- Parameterize with Zod schemas
- Include clear instructions

**Testing:**
- Test with Inspector UI first
- Use tunneling to test with real clients before deploying
- Verify all tools, resources, and prompts work as expected

**Deployment:**
- Test locally and with tunneling first
- Run `npx mcp-use login` if deploy fails
- Version your server semantically
- Document breaking changes

## Widget Support

### Automatic Widget Registration

When using the `mcp-apps` or `starter` template, widgets in the `resources/` folder are automatically registered:

```tsx
// resources/weather-display.tsx
import { useWidget, McpUseProvider, type WidgetMetadata } from 'mcp-use/react';
import { z } from 'zod';

const propSchema = z.object({
  city: z.string(),
  temperature: z.number()
});

// Required: Export widget metadata
export const widgetMetadata: WidgetMetadata = {
  description: "Display weather information",
  props: propSchema, // Use 'props', not 'schema'!
};

// Required: Export default component
export default function WeatherDisplay() {
  const { props, isPending } = useWidget<z.infer<typeof propSchema>>();

  // Always handle loading state
  if (isPending) return <div>Loading...</div>;

  return (
    <McpUseProvider autoSize>
      <div>
        <h2>{props.city}</h2>
        <p>{props.temperature}°C</p>
      </div>
    </McpUseProvider>
  );
}
```

**Widget automatically becomes available as:**
- MCP Tool: `weather-display`
- MCP Resource: `ui://widget/weather-display.html`

### Content Security Policy (CSP)

Control what external resources widgets can access:

```typescript
export const widgetMetadata: WidgetMetadata = {
  description: "Weather widget",
  props: z.object({ city: z.string() }),
  metadata: {
    csp: {
      // APIs to call
      connectDomains: ["https://api.weather.com"],
      // Static assets to load
      resourceDomains: ["https://cdn.weather.com"],
      // Iframes to embed
      frameDomains: ["https://embed.weather.com"],
      // Script directives
      scriptDirectives: ["'unsafe-inline'"],
    },
  },
};
```

Alternatively, set at server level:

```typescript
server.uiResource({
  type: "mcpApps",
  name: "my-widget",
  htmlTemplate: `...`,
  metadata: {
    csp: {
      connectDomains: ["https://api.example.com"],
      resourceDomains: ["https://cdn.example.com"],
    },
  },
});
```

## Dual-Protocol Widget Support

mcp-use supports the **MCP Apps standard** (SEP-1865) with automatic dual-protocol support:

```typescript
import { MCPServer } from 'mcp-use/server';

const server = new MCPServer({
  name: 'my-server',
  version: '1.0.0',
  baseUrl: process.env.MCP_URL || 'http://localhost:3000', // Required for widgets
});

// Register a dual-protocol widget
server.uiResource({
  type: "mcpApps", // Works with BOTH MCP Apps clients AND ChatGPT
  name: "weather-display",
  htmlTemplate: `<!DOCTYPE html>...`,
  metadata: {
    csp: { connectDomains: ["https://api.weather.com"] },
    prefersBorder: true,
    autoResize: true,
  },
});
```

**What happens automatically:**
- **MCP Apps clients** (Claude, Goose) receive: `text/html;profile=mcp-app` with `_meta.ui.*`
- **ChatGPT** receives: `text/html+skybridge` with `_meta.openai/*`
- Same widget code works everywhere!

### Custom OpenAI Metadata

Need ChatGPT-specific features? Combine both metadata fields:

```typescript
server.uiResource({
  type: "mcpApps",
  name: "my-widget",
  htmlTemplate: `...`,
  // Unified metadata (dual-protocol)
  metadata: {
    csp: { connectDomains: ["https://api.example.com"] },
    prefersBorder: true,
  },
  // ChatGPT-specific overrides
  appsSdkMetadata: {
    "openai/widgetDescription": "ChatGPT-specific description",
    "openai/customFeature": "some-value", // Any custom OpenAI metadata
  },
});
```

## Project Structure

```
my-mcp-server/
├── resources/           # React widgets (apps-sdk)
│   └── widget.tsx
├── public/             # Static assets
├── index.ts            # Server entry point
├── package.json
├── tsconfig.json
└── README.md
```

## Common Patterns

**Tool with dual-protocol widget:**
```typescript
import { MCPServer, widget, text } from 'mcp-use/server';
import { z } from 'zod';

const server = new MCPServer({
  name: 'my-server',
  version: '1.0.0',
  baseUrl: process.env.MCP_URL || 'http://localhost:3000',
});

server.tool(
  {
    name: "show-data",
    description: "Display data with visualization",
    schema: z.object({
      query: z.string()
    }),
    widget: {
      name: "data-display", // Must exist in resources/
      invoking: "Loading...",
      invoked: "Data loaded"
    }
  },
  async ({ query }) => {
    const data = await fetchData(query);
    return widget({
      props: { data },
      output: text(`Found ${data.length} results`)
    });
  }
);
```

**Resource template (parameterized):**
```typescript
server.resourceTemplate(
  {
    uriTemplate: "user://{userId}/profile",
    name: "User Profile",
    description: "Get user by ID",
    mimeType: "application/json"
  },
  async ({ userId }) => {
    const user = await fetchUser(userId);
    return object(user);
  }
);
```

**Error handling:**
```typescript
server.tool(
  {
    name: "divide",
    schema: z.object({
      a: z.number(),
      b: z.number()
    })
  },
  async ({ a, b }) => {
    if (b === 0) {
      return text("Error: Cannot divide by zero");
    }
    return text(`Result: ${a / b}`);
  }
);
```

## Detailed Examples

For comprehensive examples and advanced patterns, connect to the **mcp-use MCP server** which provides:
- Complete example resources for all primitives
- Full working server examples
- Detailed documentation
- Interactive widgets showcase

## Learn More

- **Documentation**: https://docs.mcp-use.com
- **MCP Apps Standard**: https://docs.mcp-use.com/typescript/server/mcp-apps (dual-protocol guide)
- **Templates**: https://docs.mcp-use.com/typescript/server/templates (template comparison)
- **Widget Guide**: https://docs.mcp-use.com/typescript/server/ui-widgets
- **Examples**: https://github.com/mcp-use/mcp-use/tree/main/examples
- **Tunneling Guide**: https://mcp-use.com/docs/tunneling
- **Discord**: https://mcp-use.com/discord
- **GitHub**: https://github.com/mcp-use/mcp-use

## Quick Reference

**Commands:**
- `npx create-mcp-use-app my-server` - Bootstrap
- `yarn dev` - Development mode
- `yarn build` - Build for production
- `yarn start` - Run production server
- `mcp-use start --tunnel` - Start with tunnel
- `npx mcp-use login` - Authenticate
- `yarn deploy` - Deploy to cloud

**Response helpers:**
- `text(str)`, `object(data)`, `markdown(str)`, `html(str)`
- `image(buf, mime)`, `audio(buf, mime)`, `binary(buf, mime)`
- `mix(...)` - Combine multiple content types
- `widget({ props, output })` - Return widget with data

**Server methods:**
- `server.tool()` - Define executable tool
- `server.resource()` - Define static/dynamic resource
- `server.resourceTemplate()` - Define parameterized resource
- `server.prompt()` - Define prompt template
- `server.uiResource()` - Define widget resource
- `server.listen()` - Start server

**Widget metadata fields:**
- `description` - Widget description
- `props` - Zod schema for widget props
- `metadata` - Unified config (dual-protocol)
- `metadata.csp` - Content Security Policy
- `appsSdkMetadata` - ChatGPT-specific overrides

**Available templates:**
- `starter` - Full-featured (tools, resources, prompts, widgets)
- `mcp-apps` - ChatGPT-optimized with product example
- `blank` - Minimal boilerplate

---
name: mcp-builder
description: Build Model Context Protocol (MCP) servers with mcp-use framework. Use when creating MCP servers, defining tools/resources/prompts, working with mcp-use, bootstrapping MCP projects, deploying MCP servers, or when user mentions MCP development, MCP tools, MCP resources, or MCP prompts.
---

# MCP Server Builder

Build production-ready MCP servers with the mcp-use framework.

## Quick Start

```bash
npx create-mcp-use-app my-mcp-server
cd my-mcp-server
npm install && npm run dev
```

**Templates:**
- `--template starter` - Full-featured with tools, resources, prompts, and widgets
- `--template mcp-apps` - Optimized for ChatGPT widgets
- `--template blank` - Minimal starting point

```bash
npx create-mcp-use-app my-server --template starter
```

Project structure:
```
my-mcp-server/
├── resources/           # React widgets (auto-registered)
├── public/             # Static assets
├── index.ts            # Server entry point
└── package.json
```

## Defining Tools

Tools are executable functions AI models can call:

```typescript
import { MCPServer, text, object } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
});

server.tool(
  {
    name: "greet-user",
    description: "Greet a user by name",
    schema: z.object({
      name: z.string().describe("The user's name"),
      formal: z.boolean().optional().describe("Use formal greeting"),
    }),
  },
  async ({ name, formal }) => {
    const greeting = formal ? `Good day, ${name}` : `Hey ${name}!`;
    return text(greeting);
  }
);

server.listen();
```

**Key points:**
- Use Zod for schema validation
- Add `.describe()` to all parameters
- Return response helpers: `text()`, `object()`, `widget()`

## Defining Resources

Resources expose data clients can read:

```typescript
import { object, text, markdown } from "mcp-use/server";

// Static resource
server.resource(
  {
    uri: "config://settings",
    name: "Application Settings",
    description: "Current configuration",
    mimeType: "application/json",
  },
  async () => object({ theme: "dark", version: "1.0.0" })
);

// Dynamic resource
server.resource(
  {
    uri: "stats://current",
    name: "Current Stats",
    mimeType: "application/json",
  },
  async () => {
    const stats = await getStats();
    return object(stats);
  }
);

// Markdown documentation
server.resource(
  {
    uri: "docs://guide",
    name: "User Guide",
    mimeType: "text/markdown",
  },
  async () => markdown("# Guide\n\nWelcome!")
);
```

**Response helpers:** `text()`, `object()`, `markdown()`, `html()`, `image()`, `audio()`, `binary()`, `mix()`

For advanced usage, see [references/response-helpers.md](references/response-helpers.md).

### Parameterized Resources

```typescript
server.resourceTemplate(
  {
    uriTemplate: "user://{userId}/profile",
    name: "User Profile",
    description: "Get user by ID",
    mimeType: "application/json",
  },
  async ({ userId }) => {
    const user = await fetchUser(userId);
    return object(user);
  }
);
```

For URI patterns and conventions, see [references/resource-templates.md](references/resource-templates.md).

## Defining Prompts

Prompts are reusable templates for AI interactions:

```typescript
server.prompt(
  {
    name: "code-review",
    description: "Generate a code review template",
    schema: z.object({
      language: z.string().describe("Programming language"),
      focusArea: z.string().optional().describe("Specific focus area"),
    }),
  },
  async ({ language, focusArea }) => {
    const focus = focusArea ? ` with focus on ${focusArea}` : "";
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please review this ${language} code${focus}.`,
          },
        },
      ],
    };
  }
);
```

## Testing

### Development Mode

```bash
npm run dev
```

### Inspector

Access `http://localhost:3000/inspector` to:
- Test tools with parameters
- View resources
- Try prompts
- Debug interactions

### Tunneling (Test Before Deploy)

```bash
# Auto-tunnel
mcp-use start --port 3000 --tunnel

# Or separate tunnel
npm start              # Terminal 1
npx @mcp-use/tunnel 3000  # Terminal 2
```

Get public URL like `https://happy-cat.local.mcp-use.run/mcp`

## Deployment

```bash
npx mcp-use login
npm run deploy
```

After deployment:
- Public URL provided
- Auto-scaled and monitored
- HTTPS enabled

## Widget Support

Widgets are auto-registered from `resources/` folder. For widget development, use the **chatgpt-app-builder** skill.

Basic widget example:

```tsx
// resources/weather-display.tsx
import { useWidget, McpUseProvider, type WidgetMetadata } from 'mcp-use/react';
import { z } from 'zod';

export const widgetMetadata: WidgetMetadata = {
  description: "Display weather",
  props: z.object({ city: z.string(), temp: z.number() }),
};

export default function WeatherDisplay() {
  const { props, isPending } = useWidget();
  if (isPending) return <div>Loading...</div>;

  return (
    <McpUseProvider autoSize>
      <div>{props.city}: {props.temp}°C</div>
    </McpUseProvider>
  );
}
```

**For comprehensive widget development**, see the **chatgpt-app-builder** skill.

## Tools Returning Widgets

```typescript
import { widget, text } from "mcp-use/server";

server.tool(
  {
    name: "show-weather",
    schema: z.object({ city: z.string() }),
    widget: {
      name: "weather-display", // Must exist in resources/
      invoking: "Loading...",
      invoked: "Ready",
    },
  },
  async ({ city }) => {
    const data = await fetchWeather(city);
    return widget({
      props: { city, temp: data.temp },
      output: text(`${city}: ${data.temp}°C`),
    });
  }
);
```

## Best Practices

**Tools:**
- One tool = one focused capability
- Descriptive names and descriptions
- Use `.describe()` on all Zod fields
- Handle errors gracefully

**Resources:**
- Clear URI schemes (`config://`, `docs://`, `stats://`)
- Appropriate MIME types
- Use response helpers

**Prompts:**
- Keep prompts reusable
- Parameterize with Zod schemas
- Include clear instructions

**Testing:**
- Test with Inspector first
- Use tunneling before deploying
- Verify all primitives work

## Quick Reference

**Commands:**
- `npx create-mcp-use-app my-server` - Bootstrap
- `npm run dev` - Development
- `npm run build && npm start` - Production
- `mcp-use start --tunnel` - Start with tunnel
- `npx mcp-use login` - Authenticate
- `npm run deploy` - Deploy

**Response helpers:**
- `text(str)` - Plain text
- `object(data)` - JSON
- `markdown(str)` - Markdown
- `html(str)` - HTML
- `image(buf, mime)` - Images
- `audio(buf, mime)` - Audio
- `binary(buf, mime)` - Binary
- `mix(...)` - Multiple types
- `widget({ props, output })` - Widget

**Server methods:**
- `server.tool()` - Define tool
- `server.resource()` - Define resource
- `server.resourceTemplate()` - Parameterized resource
- `server.prompt()` - Define prompt
- `server.listen()` - Start server

**Templates:**
- `starter` - Full-featured
- `mcp-apps` - ChatGPT-optimized
- `blank` - Minimal

## References

- [Response Helpers](references/response-helpers.md) - Full response helper API
- [Resource Templates](references/resource-templates.md) - URI patterns and templates

## Learn More

- Documentation: https://docs.mcp-use.com
- Examples: https://github.com/mcp-use/mcp-use/tree/main/examples
- MCP Apps: https://docs.mcp-use.com/typescript/server/mcp-apps
- GitHub: https://github.com/mcp-use/mcp-use

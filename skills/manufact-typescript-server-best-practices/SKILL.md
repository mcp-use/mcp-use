---
name: manufact-typescript-server-best-practices
description: |
  Best practices for building MCP servers with mcp-use framework.

  Use when:
  - Creating new MCP servers or tools/resources/prompts/widgets
  - Architecting server structure and deciding between primitives
  - User asks about MCP development, best practices, or mcp-use patterns
  - Debugging MCP server issues or improving existing implementations
  - Reviewing code for security, performance, or architectural concerns
---

# IMPORTANT: How to Use This Skill

This file provides a NAVIGATION GUIDE ONLY. Before implementing any MCP server features, you MUST:

1. Read this overview to understand which reference files are relevant
2. **ALWAYS read the specific reference file(s)** for the features you're implementing
3. Apply the detailed patterns from those files to your implementation

**Do NOT rely solely on the quick reference examples in this file** - they are minimal examples only. The reference files contain critical best practices, security considerations, and advanced patterns.

---

# MCP Server Best Practices

Comprehensive guide for building production-ready MCP servers with tools, resources, prompts, and widgets using mcp-use.

## Quick Navigation

**Choose your path based on what you're building:**

### 🚀 Just Getting Started?
**When:** You're new to mcp-use typescript server sdk and want to understand the fundamentals 

1. **[concepts.md](references/foundations/concepts.md)** - Understand the 4 MCP primitives (Tool, Resource, Prompt, Widget) and when to use each
2. **[quickstart.md](references/foundations/quickstart.md)** - Build your first tool in 5 minutes with hands-on examples

---

### 🔧 Building Server Backend (No UI)?
**When:** Creating tools, resources, or prompts without visual widgets

- **[tools.md](references/server/tools.md)**
  - When: Creating backend actions the AI can call (send-email, fetch-data, create-user)
  - Covers: Tool definition, schemas, annotations, context, error handling

- **[resources.md](references/server/resources.md)**
  - When: Exposing read-only data clients can fetch (config, user profiles, documentation)
  - Covers: Static resources, dynamic resources, parameterized resource templates

- **[prompts.md](references/server/prompts.md)**
  - When: Creating reusable message templates for AI interactions (code-review, summarize)
  - Covers: Prompt definition, parameterization, prompt best practices

- **[response-helpers.md](references/server/response-helpers.md)**
  - When: Formatting responses from tools/resources (text, JSON, markdown, images, errors)
  - Covers: `text()`, `object()`, `markdown()`, `image()`, `error()`, `mix()`

---

### 🎨 Building Visual Widgets (Interactive UI)?
**When:** Creating React-based visual interfaces for browsing, comparing, or selecting data

- **[basics.md](references/widgets/basics.md)**
  - When: Creating your first widget or adding UI to an existing tool
  - Covers: Widget setup, `useWidget()` hook, `isPending` checks, props handling

- **[state.md](references/widgets/state.md)**
  - When: Managing UI state (selections, filters, tabs) within widgets
  - Covers: `useState`, `setState`, state persistence, when to use tool vs widget state

- **[interactivity.md](references/widgets/interactivity.md)**
  - When: Adding buttons, forms, or calling tools from within widgets
  - Covers: `callTool()`, form handling, action buttons, optimistic updates

- **[ui-guidelines.md](references/widgets/ui-guidelines.md)**
  - When: Styling widgets to support themes, responsive layouts, or accessibility
  - Covers: `useWidgetTheme()`, light/dark mode, `autoSize`, layout patterns, CSS best practices

- **[advanced.md](references/widgets/advanced.md)**
  - When: Building complex widgets with async data, error boundaries, or performance optimizations
  - Covers: Loading states, error handling, memoization, code splitting

---

### 📚 Need Complete Examples?
**When:** You want to see full implementations of common use cases

- **[common-patterns.md](references/patterns/common-patterns.md)**
  - End-to-end examples: weather app, todo list, recipe browser
  - Shows: Server code + widget code + best practices in context

---

## Decision Tree

```
What do you need to build?

├─ Simple backend action (no UI)
│  └─> Use Tool: server/tools.md
│
├─ Read-only data for clients
│  └─> Use Resource: server/resources.md
│
├─ Reusable prompt template
│  └─> Use Prompt: server/prompts.md
│
└─ Visual/interactive UI
   └─> Use Widget: widgets/basics.md
```

---

## Core Principles

1. **Tools for actions** - Backend operations with input/output
2. **Resources for data** - Read-only data clients can fetch
3. **Prompts for templates** - Reusable message templates
4. **Widgets for UI** - Visual interfaces when helpful
5. **Mock data first** - Prototype quickly, connect APIs later

---

## ❌ Common Mistakes

Avoid these anti-patterns found in production MCP servers:

### Tool Definition
- ❌ Returning raw objects instead of using response helpers
  - ✅ Use `text()`, `object()`, `widget()`, `error()` helpers
- ❌ Skipping Zod schema `.describe()` on every field
  - ✅ Add descriptions to all schema fields for better AI understanding
- ❌ No input validation or sanitization
  - ✅ Validate inputs with Zod, sanitize user-provided data
- ❌ Throwing errors instead of returning `error()` helper
  - ✅ Use `error("message")` for graceful error responses

### Widget Development
- ❌ Accessing `props` without checking `isPending`
  - ✅ Always check `if (isPending) return <Loading/>`
- ❌ Widget handles server state (filters, selections)
  - ✅ Widgets manage their own UI state with `useState`
- ❌ Missing `McpUseProvider` wrapper or `autoSize`
  - ✅ Wrap root component: `<McpUseProvider autoSize>`
- ❌ Inline styles without theme awareness
  - ✅ Use `useWidgetTheme()` for light/dark mode support

### Security & Production
- ❌ Hardcoded API keys or secrets in code
  - ✅ Use `process.env.API_KEY`, document in `.env.example`
- ❌ No error handling in tool handlers
  - ✅ Wrap in try/catch, return `error()` on failure
- ❌ Expensive operations without caching
  - ✅ Cache API calls, computations with TTL
- ❌ Missing CORS configuration
  - ✅ Configure CORS for production deployments

---

## 🔒 Golden Rules

**Opinionated architectural guidelines:**

### 1. One Tool = One Capability
Split broad actions into focused tools:
- ❌ `manage-users` (too vague)
- ✅ `create-user`, `delete-user`, `list-users`

### 2. Return Complete Data Upfront
Tool calls are expensive. Avoid lazy-loading:
- ❌ `list-products` + `get-product-details` (2 calls)
- ✅ `list-products` returns full data including details

### 3. Widgets Own Their State
UI state lives in the widget, not in separate tools:
- ❌ `select-item` tool, `set-filter` tool
- ✅ Widget manages with `useState` or `setState`

### 4. Use `exposeAsTool: false` for Custom Widget Tools
Prevent duplicate tool registration:
```typescript
export const widgetMetadata: WidgetMetadata = {
  description: "...",
  props: z.object({...}),
  exposeAsTool: false  // ← Critical for custom tools
};
```

### 5. Validate at Boundaries Only
- Trust internal code and framework guarantees
- Validate user input, external API responses
- Don't add error handling for scenarios that can't happen

### 6. Prefer Widgets for Browsing/Comparing
When in doubt, add a widget. Visual UI improves:
- Browsing multiple items
- Comparing data side-by-side
- Interactive selection workflows

---

## Quick Reference

### Minimal Server
```typescript
import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "my-server",
  title: "My Server",
  version: "1.0.0"
});

server.tool(
  {
    name: "greet",
    description: "Greet a user",
    schema: z.object({ name: z.string().describe("User's name") })
  },
  async ({ name }) => text("Hello " + name + "!"),
);

server.listen();
```

### With Widget
```typescript
// Tool with widget
server.tool(
  {
    name: "show-weather",
    schema: z.object({ city: z.string() }),
    widget: { name: "weather-display" }
  },
  async ({ city }) => widget({
    props: { city, temp: 22, conditions: "Sunny" },
    output: text(`Weather in ${city}: 22°C, Sunny`)
  })
);
```

```tsx
// resources/weather-display.tsx
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

export const widgetMetadata: WidgetMetadata = {
  description: "Display weather information",
  props: z.object({
    city: z.string(),
    temp: z.number(),
    conditions: z.string()
  }),
  exposeAsTool: false
};

export default function WeatherDisplay() {
  const { props, isPending } = useWidget();

  if (isPending) {
    return <McpUseProvider autoSize><div>Loading...</div></McpUseProvider>;
  }

  return (
    <McpUseProvider autoSize>
      <div style={{ padding: 20 }}>
        <h2>{props.city}</h2>
        <div style={{ fontSize: 48 }}>{props.temp}°C</div>
        <p>{props.conditions}</p>
      </div>
    </McpUseProvider>
  );
}
```

---

## Response Helpers

| Helper | Use When | Example |
|--------|----------|---------|
| `text()` | Simple string response | `text("Success!")` |
| `object()` | Structured data | `object({ status: "ok" })` |
| `markdown()` | Formatted text | `markdown("# Title\nContent")` |
| `widget()` | Visual UI | `widget({ props: {...}, output: text(...) })` |
| `mix()` | Multiple contents | `mix(text("Hi"), image(url))` |
| `error()` | Error responses | `error("Failed to fetch data")` |
| `resource()` | Embed resource refs | `resource("docs://guide", "text/markdown")` |


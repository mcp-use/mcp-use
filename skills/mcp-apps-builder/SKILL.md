---
name: mcp-apps-builder
description: |
  Implements mcp-use framework patterns for building production-ready MCP servers. Use when creating new MCP servers with `npx create-mcp-use-app`, implementing `server.tool()` handlers with Zod schemas, defining `server.resource()` or `server.resourceTemplate()` endpoints, authoring `server.prompt()` templates, building React-based visual widgets with `useWidget()` and `useCallTool()`, configuring OAuth authentication (WorkOS, Supabase, or custom providers), formatting tool responses with `text()`, `object()`, `markdown()`, `widget()`, or `error()` helpers, composing multiple MCP servers via `server.proxy()`, deploying to Manufact Cloud or Docker, debugging MCP server errors, or reviewing MCP server code for quality and security. Always consult before modifying any MCP server feature.
---

# MCP Server Best Practices

Comprehensive guide for building production-ready MCP servers with tools, resources, prompts, and widgets using mcp-use.

> **Before implementing any feature, identify your path in Quick Navigation below and read the relevant reference file(s). The examples in this file are minimal — full best practices, security guidance, and advanced patterns live in the references.**

## ⚠️ FIRST: New Project or Existing Project?

**Before doing anything else, determine whether you are inside an existing mcp-use project.**

**Detection:** Check the workspace for a `package.json` that lists `"mcp-use"` as a dependency, OR any `.ts` file that imports from `"mcp-use/server"`.

```
├─ mcp-use project FOUND → Do NOT scaffold. You are already in a project.
│  └─ Skip to "Quick Navigation" below to add features.
│
├─ NO mcp-use project (empty dir, unrelated project, or greenfield)
│  └─ Scaffold first with npx create-mcp-use-app, then add features.
│     See "Scaffolding a New Project" below.
│
└─ Inside an UNRELATED project (e.g. Next.js app) and user wants an MCP server
   └─ Ask the user where to create it, then scaffold in that directory.
      Do NOT scaffold inside an existing unrelated project root.
```

**NEVER manually create `MCPServer` boilerplate, `package.json`, or project structure by hand.** The CLI sets up TypeScript config, dev scripts, inspector integration, hot reload, and widget compilation that are difficult to replicate manually.

---

### Scaffolding a New Project

```bash
npx create-mcp-use-app my-server
cd my-server
npm run dev
```

For full scaffolding details and CLI flags, see **[quickstart.md](references/foundations/quickstart.md)**.

---

## Quick Navigation

**Choose your path based on what you're building:**

### 🚀 Foundations
**When:** ALWAYS read these first when starting MCP work in a new conversation. Reference later for architecture/concept clarification.

1. **[concepts.md](references/foundations/concepts.md)** - MCP primitives (Tool, Resource, Prompt, Widget) and when to use each
2. **[architecture.md](references/foundations/architecture.md)** - Server structure (Hono-based), middleware system, server.use() vs server.app
3. **[quickstart.md](references/foundations/quickstart.md)** - Scaffolding, setup, and first tool example
4. **[deployment.md](references/foundations/deployment.md)** - Deploying to Manufact Cloud, self-hosting, Docker, managing deployments

Load these before diving into tools/resources/widgets sections.

---

### 🔐 Adding Authentication?
**When:** Protecting your server with OAuth (WorkOS, Supabase, or custom)

- **[overview.md](references/authentication/overview.md)**
  - When: First time adding auth, understanding `ctx.auth`, or choosing a provider
  - Covers: `oauth` config, user context shape, provider comparison, common mistakes

- **[workos.md](references/authentication/workos.md)**
  - When: Using WorkOS AuthKit for authentication
  - Covers: Setup, env vars, DCR vs pre-registered, roles/permissions, WorkOS API calls

- **[supabase.md](references/authentication/supabase.md)**
  - When: Using Supabase for authentication
  - Covers: Setup, env vars, HS256 vs ES256, RLS-aware API calls

- **[custom.md](references/authentication/custom.md)**
  - When: Using any other identity provider (GitHub, Okta, Azure AD, Google, etc.)
  - Covers: Custom verification, user info extraction, provider examples

---

### 🔧 Building Server Backend (No UI)?
**When:** Implementing MCP features (actions, data, templates). Read the specific file for the primitive you're building.

- **[tools.md](references/server/tools.md)**
  - When: Creating backend actions the AI can call (send-email, fetch-data, create-user)
  - Covers: Tool definition, schemas, annotations, context, error handling

- **[resources.md](references/server/resources.md)**
  - When: Exposing read-only data clients can fetch (config, user profiles, documentation)
  - Covers: Static resources, dynamic resources, parameterized resource templates, URI completion

- **[prompts.md](references/server/prompts.md)**
  - When: Creating reusable message templates for AI interactions (code-review, summarize)
  - Covers: Prompt definition, parameterization, argument completion, prompt best practices

- **[response-helpers.md](references/server/response-helpers.md)**
  - When: Formatting responses from tools/resources (text, JSON, markdown, images, errors)
  - Covers: `text()`, `object()`, `markdown()`, `image()`, `error()`, `mix()`

- **[proxy.md](references/server/proxy.md)**
  - When: Composing multiple MCP servers into one unified aggregator server
  - Covers: `server.proxy()`, config API, explicit sessions, sampling routing

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
  - Covers: `useCallTool()`, form handling, action buttons, optimistic updates

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

## 🔒 Principles & Golden Rules

1. **Tools for actions, Resources for data, Prompts for templates, Widgets for UI** — use the right primitive; prefer widgets for browsing/comparing multiple items.
2. **One Tool = One Capability** — ❌ `manage-users` → ✅ `create-user`, `delete-user`, `list-users`
3. **Return complete data upfront** — tool calls are expensive; avoid lazy-loading: ❌ `list-products` + `get-product-details` → ✅ `list-products` returns full details
4. **Widgets own their UI state** — manage selections/filters with `useState`/`setState`, not tool calls
5. **Validate at boundaries only** — validate user input and external API responses; trust internal framework guarantees
6. **Mock data first** — prototype quickly, connect APIs later

### `exposeAsTool` Defaults to `false`
Widgets are registered as resources only by default. Use a custom tool (recommended) or set `exposeAsTool: true` to expose a widget to the model:

```typescript
// ✅ ALL 4 STEPS REQUIRED for proper type inference:

// Step 1: Define schema separately
const propsSchema = z.object({
  title: z.string(),
  items: z.array(z.string())
});

// Step 2: Reference schema variable in metadata
export const widgetMetadata: WidgetMetadata = {
  description: "...",
  props: propsSchema,  // ← NOT inline z.object()
  exposeAsTool: false
};

// Step 3: Infer Props type from schema variable
type Props = z.infer<typeof propsSchema>;

// Step 4: Use typed Props with useWidget
export default function MyWidget() {
  const { props, isPending } = useWidget<Props>();  // ← Add <Props>
  // ...
}
```

⚠️ **Common mistake:** Only doing steps 1-2 but skipping 3-4 (loses type safety)

---

## ❌ Common Mistakes

Avoid these anti-patterns found in production MCP servers:

### Tool Definition
- ❌ Returning raw objects → ✅ Use `text()`, `object()`, `widget()`, `error()` helpers
- ❌ Skipping Zod schema `.describe()` on fields → ✅ Add descriptions to all schema fields
- ❌ No input validation → ✅ Validate with Zod, sanitize user-provided data
- ❌ Throwing errors → ✅ Use `error("message")` for graceful error responses

### Widget Development
- ❌ Accessing `props` without checking `isPending` → ✅ Always render `<Loading/>` guard first
- ❌ Widget handles server state (filters, selections) → ✅ Use `useState` for UI state
- ❌ Missing `McpUseProvider` wrapper or `autoSize` → ✅ Wrap root: `<McpUseProvider autoSize>`
- ❌ Inline styles without theme awareness → ✅ Use `useWidgetTheme()` for light/dark support

### Security & Production
- ❌ Hardcoded API keys → ✅ Use `process.env.API_KEY`, document in `.env.example`
- ❌ No error handling in tool handlers → ✅ Wrap in try/catch, return `error()` on failure
- ❌ Expensive operations without caching → ✅ Cache API calls with TTL
- ❌ Missing CORS configuration → ✅ Configure CORS for production deployments

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

**Server methods:**
- `server.tool()` - Define executable tool
- `server.resource()` - Define static/dynamic resource
- `server.resourceTemplate()` - Define parameterized resource
- `server.prompt()` - Define prompt template
- `server.proxy()` - Compose/Proxy multiple MCP servers
- `server.uiResource()` - Define widget resource
- `server.listen()` - Start server

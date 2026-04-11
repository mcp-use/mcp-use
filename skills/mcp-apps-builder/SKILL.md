---
name: mcp-apps-builder
description: |
  **MANDATORY for ALL MCP server work** - mcp-use framework best practices and patterns.

  **READ THIS FIRST** before any MCP server work, including:
  - Creating new MCP servers
  - Modifying existing MCP servers (adding/updating tools, resources, prompts, widgets)
  - Debugging MCP server issues or errors
  - Reviewing MCP server code for quality, security, or performance
  - Answering questions about MCP development or mcp-use patterns
  - Making ANY changes to server.tool(), server.resource(), server.prompt(), or widgets

  This skill contains critical architecture decisions, security patterns, and common pitfalls.
  Always consult the relevant reference files BEFORE implementing MCP features.
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
**When:** Protecting your server with OAuth (WorkOS, Supabase, Better Auth, or custom)

- **[overview.md](references/authentication/overview.md)**
  - When: First time adding auth, understanding `ctx.auth`, or choosing a provider
  - Covers: `oauth` config, user context shape, provider comparison, common mistakes

- **[workos.md](references/authentication/workos.md)**
  - When: Using WorkOS AuthKit for authentication
  - Covers: Setup, env vars, DCR vs pre-registered, roles/permissions, WorkOS API calls

- **[supabase.md](references/authentication/supabase.md)**
  - When: Using Supabase for authentication
  - Covers: Setup, env vars, HS256 vs ES256, RLS-aware API calls

- **[better-auth.md](references/authentication/better-auth.md)**
  - When: Using Better Auth with the `@better-auth/oauth-provider` plugin (self-hosted OAuth 2.1)
  - Covers: `oauthBetterAuthProvider`, auth URL / metadata routes, login and consent flows

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

- **[architecture.md](references/foundations/architecture.md)**
  - When: Adding cross-cutting logic (logging, auth checks, rate limiting, tool filtering) that spans multiple tools/resources
  - Covers: `server.use('mcp:...')` middleware, `MiddlewareContext` (method, params, auth, state), pattern matching, HTTP vs MCP middleware

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

- **[model-context.md](references/widgets/model-context.md)**
  - When: Keeping the AI model aware of what the user is currently seeing (active tab, hovered item, selected product) without requiring tool calls
  - Covers: `<ModelContext>` component, `modelContext.set/remove` imperative API, nesting, tree serialization, lifecycle rules
- **[files.md](references/widgets/files.md)**
  - When: Uploading or downloading files from within a widget (ChatGPT Apps SDK only)
  - Covers: `useFiles()` hook, `isSupported` guard, model visibility (`modelVisible`), storing `fileId`, temporary download URLs

---

### 📚 Need Complete Examples?
**When:** You want to see full implementations of common use cases

- **[common-patterns.md](references/patterns/common-patterns.md)**
  - End-to-end examples: weather app, todo list, recipe browser
  - Shows: Server code + widget code + best practices in context

---

## Decision Tree

```
What do you need?

├─ New project from scratch
│  └─> quickstart.md (scaffolding + setup)
│
├─ OAuth / user authentication
│  └─> authentication/overview.md → provider-specific guide
│
├─ Simple backend action (no UI)
│  └─> Use Tool: server/tools.md
│
├─ Read-only data for clients
│  └─> Use Resource: server/resources.md
│
├─ Reusable prompt template
│  └─> Use Prompt: server/prompts.md
│
├─ Cross-cutting logic (logging, auth checks, rate limiting, tool filtering)
│  └─> Use Middleware: architecture.md#mcp-middleware
│
├─ Visual/interactive UI
│  └─> Use Widget: widgets/basics.md
│
├─ Keep model aware of what user is seeing in widget
│  └─> widgets/model-context.md
├─ Upload/download files in a widget
│  └─> widgets/files.md (ChatGPT Apps SDK only)
│
└─ Deploy to production
   └─> deployment.md (cloud deploy, self-hosting, Docker)
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

### 4. `exposeAsTool` Defaults to `false`
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
- `server.use('mcp:tools/call', fn)` - MCP middleware (tools, resources, prompts, list ops)
- `server.use('mcp:*', fn)` - Catch-all MCP middleware
- `server.use(fn)` - HTTP middleware (Hono)



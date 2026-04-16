# MCP Concepts

Core primitives you'll use to build MCP servers with mcp-use.

## The Four Primitives

### 1. Tool
A **backend action** the AI can call. Takes input, returns output.

**Use for:** Actions, operations, mutations, API calls

```typescript
server.tool({ name, description, schema }, async (input) => {
  // Your logic here
  return text("result");
});
```

→ **Detailed guide:** [../server/tools.md](../server/tools.md)

### 2. Resource
**Read-only data** that clients can fetch. No input parameters (use resource templates for that).

**Use for:** Configuration, static data, listings

```typescript
server.resource({ uri, name, mimeType }, async () => {
  return object({ data });
});
```

→ **Detailed guide:** [../server/resources.md](../server/resources.md)

### 3. Prompt
A **reusable message template** with parameters.

**Use for:** Common prompts, instruction templates

```typescript
server.prompt({ name, description, schema }, async (input) => {
  return text(`Your prompt template with ${input.param}`);
});
```

→ **Detailed guide:** [../server/prompts.md](../server/prompts.md)

### 4. Widget (tool + UI)
A **tool that returns JSX**: import a React component and return it from the handler with `_output` and other `_` props. The mcp-use JSX runtime registers the widget bundle and protocol metadata.

**Use for:** Browsing data, interactive selection, visual feedback

```tsx
/** @jsxImportSource mcp-use/jsx */
// return <MyWidget data={...} _output={text("...")} />;
```

→ **Detailed guide:** [../widgets/basics.md](../widgets/basics.md)

---

## Decision Matrix

| Need | Use | Example |
|------|-----|---------|
| Backend action | Tool | send-email, create-user, fetch-data |
| Read-only data | Resource | config, user-profile, api-docs |
| Prompt template | Prompt | code-review, summarize, translate |
| Visual UI | Widget Tool | search-results, calendar, dashboard |

---

## Tool vs Widget?

**Use a tool (no widget) when:**
- Output is simple text or data
- No visual representation helps
- Quick conversational response

**Use a widget when:**
- Browsing/comparing multiple items
- Visual data improves understanding (charts, images)
- Interactive selection is easier visually

**When in doubt:** Use a widget. It makes the experience better.

---

## Key Patterns

### 1. One tool = one capability
❌ `manage-users` (too broad)
✅ `create-user`, `delete-user`, `list-users`

### 2. Don't lazy-load
Tool calls are expensive. Return all needed data upfront.

❌ `list-products` + `get-product-details` (two calls)
✅ `list-products` returns full data including details

### 3. Widget handles its own state
UI state (selections, filters) lives in the widget via `useState` or `setState`.

❌ `select-item` tool, `set-filter` tool
✅ Widget manages internally

### 4. One tool registration for widgets
Expose UI by returning JSX from **`server.tool()`**. You do not register a separate auto-generated tool for the same UI in the primary pattern.

---

## Next Steps

- Build your first tool: [quickstart.md](quickstart.md)
- Deep dive on tools: [../server/tools.md](../server/tools.md)
- Learn about widgets: [../widgets/basics.md](../widgets/basics.md)

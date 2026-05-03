# MCP Apps — Programmatic Widget Gallery

[![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-use%2Ftree%2Fmain%2Flibraries%2Ftypescript%2Fpackages%2Fmcp-use%2Fexamples%2Fserver%2Fui%2Fmcp-ui&branch=main&project-name=mcp-apps-gallery&build-command=npm+install&start-command=npm+run+build+%26%26+npm+run+start&port=3000&runtime=node&base-image=node%3A20)

Three widgets. No build step. Works in ChatGPT, Claude, and any MCP Apps client.

This example uses `server.uiResource({ type: "mcpApps", htmlTemplate })` — the **programmatic** path for widgets. You define HTML+JS inline, declare typed props, and the server auto-registers a tool + resource for each widget. Dual-protocol (ChatGPT Apps SDK + MCP Apps Extension) is automatic.

## Widgets

| Widget | Props | What it shows |
|---|---|---|
| `welcome-card` | none | Static info card — simplest possible widget |
| `quick-poll` | `question`, `options` | Client-side JS: vote buttons with live tally |
| `task-card` | `title`, `status`, `priority`, `assignee`, ... | Data-driven card with typed props and conditional rendering |

## Run it

```bash
npm install
npm run dev     # hot reload, Inspector at http://localhost:3000/inspector
# or
npm run build && npm run start
```

## Call the widgets

```typescript
await client.callTool('welcome-card', {});

await client.callTool('quick-poll', {
  question: 'Favorite framework?',
  options: ['React', 'Vue', 'Svelte'],
});

await client.callTool('task-card', {
  title: 'Ship the release',
  status: 'in-progress',
  priority: 'high',
  assignee: 'Alice',
});
```

## Programmatic vs. React auto-discovery

This example uses the **programmatic** `uiResource` pattern. Use it when:

- The widget is small and doesn't need React components
- You want zero build overhead
- You want a single file with everything inline

For full React widgets with auto-discovery, JSX, hot-reload, and Tailwind support, see [`../mcp-apps/`](../mcp-apps/) — it exports widgets via `widget.tsx` files in `resources/` that get built with the mcp-use CLI.

## Anatomy of a widget

```typescript
server.uiResource({
  type: "mcpApps",              // dual-protocol (ChatGPT + MCP Apps)
  name: "my-widget",            // tool & resource name
  title: "Human-readable title",
  description: "What the widget does",
  props: {
    count: { type: "number", required: true, description: "..." },
  },
  htmlTemplate: `<!DOCTYPE html>...`,  // parse props via URLSearchParams
  metadata: {
    prefersBorder: true,        // MCP Apps clients will render a border
    widgetDescription: "...",   // ChatGPT uses this
  },
  exposeAsTool: true,           // registers a tool with the same name
});
```

The widget receives props as a JSON-encoded `?props=...` query parameter. Parse it in your template:

```html
<script>
  const params = new URLSearchParams(window.location.search);
  const props = JSON.parse(params.get('props') || '{}');
  // use props.count, props.foo, ...
</script>
```

## Learn more

- [MCP Apps docs](https://mcp-use.com/docs/typescript/server/mcp-apps) — full API reference
- [Creating an MCP App](https://mcp-use.com/docs/typescript/server/creating-mcp-apps-server) — step-by-step guide
- [Templates](https://github.com/mcp-use/mcp-use#templates) — ready-to-deploy example apps

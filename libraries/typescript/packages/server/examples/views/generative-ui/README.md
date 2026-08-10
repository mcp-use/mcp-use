# Generative UI example

Port of the `json-render` MCP example to an `mcp-use` MCP Apps view. It lets a
model generate a catalog-constrained JSON UI and renders that UI as the
structured `spec` tool argument streams into the iframe.

## What this demonstrates

- **json-render with mcp-use** — the shared catalog uses
  `@json-render/core`, `@json-render/react`, and the shadcn component catalog.
- **Real-time UI rendering** — the model writes a structured `spec` argument
  to `render-ui`. While the call is pending, `useToolContext<"render-ui">()`
  receives `DeepPartial` snapshots from
  `ui/notifications/tool-input-partial`; the view renders as soon as the root
  element is present and updates as more elements arrive.
- **No stringified JSON stream** — `spec` is a structured Zod schema. MCP Apps
  can progressively parse it without the view needing to repair incomplete JSON
  strings.
- **Terminal result** — the final, validated spec is returned as
  `structuredContent`, so the same rendered surface remains available after the
  tool call completes.
- **Host-aware styling** — `ThemeProvider` applies the host theme and CSS
  variables; the view asks Tailwind to scan json-render's shadcn package.

The pending `toolInput` snapshot is provisional. The view only passes it to
`Renderer` after both `spec.root` and that root element exist; `loading` stays
true until the final result so child references that are still streaming do not
produce warnings.

## Run locally

From the TypeScript monorepo root:

```sh
pnpm install
pnpm --filter mcp-use-example-generative-ui dev
```

Open the inspector URL printed by the dev server, then ask it to render a
dashboard, profile, task list, or another compact interface. The `render-ui`
tool description asks the model to emit the root and root element first, making
the view visible before the whole spec has finished streaming.

```sh
pnpm --filter mcp-use-example-generative-ui typecheck
pnpm --filter mcp-use-example-generative-ui build
pnpm --filter mcp-use-example-generative-ui start
```

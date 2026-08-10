---
name: mcp-apps-builder
description: Build, modify, debug, migrate, or review TypeScript MCP servers and interactive MCP Apps using mcp-use v2. Use for tools, resources, prompts, Views, React host interactions, OAuth, middleware, Inspector workflows, package-boundary migrations, and release-ready verification in an mcp-use project.
---

# Build MCP Apps with mcp-use v2

Treat the installed `mcp-use` package, its generated types, and the project's existing exports as the source of truth. Check the installed version before changing code; do not assume APIs from mcp-use v1.

## Workflow

1. Inspect `package.json`, the server entry, exported tool refs, `views/`, and the installed `mcp-use` version.
2. Scaffold a new project with `npx create-mcp-use-app@latest`; do not hand-build framework boilerplate.
3. Read only the references needed for the task:
   - [Server primitives](references/server.md) for tools, resources, prompts, middleware, and result envelopes.
   - [Views](references/views.md) for interactive MCP Apps and React hooks.
   - [Authentication](references/auth.md) for OAuth providers and authenticated tool handlers.
   - [Migration](references/migration.md) when converting v1 code or reviewing package boundaries.
   - [Verification](references/verification.md) before reporting completion.
4. Implement against the package types. Export every statically declared tool ref that a View calls.
5. Validate through the real lifecycle: build/typecheck, run the server, connect a client, call the tool, and render the View when one exists.

## Native v2 invariants

- Import server APIs from `mcp-use`; provider adapters come from `mcp-use/oauth/*`; React APIs come from `mcp-use/react`.
- Define tools with `inputSchema`; add `outputSchema` when returning structured data or binding a View.
- Return MCP result envelopes with `content`, `structuredContent`, and optionally `_meta` or `isError`.
- Put each View at `views/<name>/view.tsx` and bind it with `view: { name: "<name>" }`.
- Read the rendering call with `useToolContext`; use focused hooks such as `useCallTool`, `useViewState`, `useHostContext`, and `useDisplayMode` for additional behavior.
- Export the server as the default export. Let `mcp-use dev`, `build`, and `start` own framework lifecycle and View compilation.
- Keep request state in the request context or an external store. Do not rely on module globals for cross-request identity or elicitation continuity.

## Minimal server and View

```ts
import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({ name: "catalog", version: "1.0.0" });

export const showProduct = server.tool(
  {
    name: "show-product",
    description: "Show one catalog product",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ id: z.string(), name: z.string() }),
    view: { name: "product" },
  },
  async ({ id }) => {
    const product = { id, name: "Example product" };
    return {
      content: [{ type: "text", text: JSON.stringify(product) }],
      structuredContent: product,
    };
  },
);

export default server;
```

```tsx
// views/product/view.tsx
import { ThemeProvider, useToolContext } from "mcp-use/react";

export default function ProductView() {
  const view = useToolContext<"show-product">();
  if (view.status === "pending") return <p>Loading…</p>;
  if (view.status === "error") return <p>{view.error.message}</p>;
  return <ThemeProvider>{view.toolOutput.name}</ThemeProvider>;
}
```

## Guardrails

- Do not copy examples from v1 docs or historical changelogs.
- Do not invent exports or configuration fields; confirm them in installed declarations or source.
- Do not return a plain domain object from a tool callback.
- Do not bind a View without an `outputSchema` and matching `structuredContent`.
- Do not claim success from a source build alone when package exports or interactive behavior changed.
- Do not deploy or mutate external systems unless the user explicitly requests it.

Run `node <skill-dir>/scripts/check-v2.mjs <project-root>` during migrations and reviews, then complete the focused checks in [Verification](references/verification.md).

## Agent Skills

Put reusable agent workflows in `skills/<name>/SKILL.md`; the directory is
served automatically, so normally omit the `skills` server option. Use
`skills: false` to disable it or `skills: { directory: "server-skills" }` to
override the project-relative directory. Keep supporting references, scripts,
templates, and assets in the skill instead of inflating tool descriptions.

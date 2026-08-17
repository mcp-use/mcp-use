---
name: mcp-builder
description: Build, modify, debug, migrate, review, or verify TypeScript MCP servers and MCP Apps with mcp-use. Use for tools, resources, prompts, middleware, Views, authentication, Skills over MCP, scaffolding, and advanced features.
---

# Build with mcp-use

Treat the installed `mcp-use` package, its exported types, generated declarations, and the project's existing code as the source of truth. Inspect the installed version before choosing APIs or changing code.

## Workflow

1. Inspect `package.json`, the server entry, exported tool refs, `mcp-env.d.ts`, `views/`, `skills/`, and the installed `mcp-use` version.
2. Scaffold a new stable project with `create-mcp-use-app@latest` and the appropriate template. Match the package version or dist-tag when working on beta, canary, or an existing versioned project.
3. Read only the references needed for the task:
   - [Server](references/server.md) for tools, resources, prompts, MCP middleware, request context, and result envelopes.
   - [Views](references/views.md) for interactive MCP Apps, React hooks, model context, host capabilities, assets, and CSP.
   - [Authentication](references/auth.md) for OAuth providers, verified identity, scopes, permissions, and authorization.
   - [Skills over MCP](references/skills-over-mcp.md) when a server should ship reusable workflows alongside its tools.
   - [Advanced features](references/advanced-features.md) for OpenAPI, proxying, notifications, subscriptions, and elicitation.
   - [Migration](references/migration.md) only when retired or compatibility-only imports, helpers, registration shapes, UI patterns, or session assumptions are present.
   - [Verification](references/verification.md) before reporting implementation work complete.
4. Implement against installed types. Prefer the framework's current conventions over copied examples or historical changelogs.
5. Validate the smallest real lifecycle that proves the changed behavior, then expand checks in proportion to risk.

## Core invariants

- Import server APIs from `mcp-use`, React APIs from `mcp-use/react`, and OAuth provider adapters from their `mcp-use/oauth/*` subpaths.
- Define tool arguments with `inputSchema`. Add `outputSchema` for structured results and every View-bound tool.
- Return raw MCP result envelopes. A successful schema-backed tool must include matching `structuredContent`; an expected failure may return `isError: true` with model-readable `content`.
- Put each View at `views/<name>/view.tsx` and bind it with `view: { name: "<name>" }`.
- Export every statically declared tool ref consumed by a View. Default-export the server entry used by `mcp-use dev`, `build`, and `start`.
- Keep identity and mutable workflow state request-scoped or in an external store. Treat client-reported metadata as unverified.
- Consider Skills over MCP when a server exposes a repeatable, multi-step workflow that would otherwise inflate tool descriptions.

## Guardrails

- Do not invent exports, configuration fields, or callback shapes. Confirm uncertain details in installed declarations or source.
- Do not preserve APIs that are absent from the installed version merely because they appear in an existing project.
- Do not return a plain domain object from a tool callback.
- Do not bind a View without a matching `outputSchema` and `structuredContent` result.
- Do not use module globals for cross-request identity, elicitation continuity, or durable business state.
- Do not claim success from a source build alone when types, package exports, authentication, or interactive behavior changed.
- Do not deploy or mutate external systems unless the user explicitly requests it.

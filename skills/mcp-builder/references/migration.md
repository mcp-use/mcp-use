# Migrate older mcp-use patterns

Read this reference only when the project contains retired or compatibility-only patterns that are absent from or no longer preferred by the installed package. Migrate behavior, not names alone, and verify every changed boundary against installed types.

## Replace retired patterns

| Older or compatibility pattern | Current replacement |
| --- | --- |
| Server imports from `mcp-use/server` | Import public server APIs from `mcp-use` |
| Tool `schema` | Tool `inputSchema`; prompt arguments still use `schema` |
| Inline callback fields | Pass the callback as the registration method's second argument |
| Chained `server.tool(...).tool(...)` | Register separately; `tool()` returns a `ToolRef` |
| Nested resource-template configuration | Top-level `uriTemplate` and `complete` fields |
| Response helpers as the default result path | Raw tool, resource, or prompt protocol envelopes |
| `resources/<name>/widget.tsx` | `views/<name>/view.tsx` |
| Tool `widget: { name }` | Tool `view: { name }` |
| `widget({ props, output })` | `{ content, structuredContent, _meta? }` |
| `useWidget()` or `useWidgetProps()` | Destructured `useToolContext<"tool-name">()` |
| Aggregate provider wrapper | Runtime bootstrap plus focused React hooks and components |
| Aggregate widget state and host methods | `useViewState`, `useHostContext`, `useDisplayMode`, and focused hooks |

Do not mechanically rename every `schema`: prompts intentionally retain that field. Confirm resource and prompt callback signatures independently from tools.

## Rebuild interactive UI

For each rendering tool:

1. Move the entry to `views/<name>/view.tsx`.
2. Export the tool ref from the server entry.
3. Add `outputSchema` and `view: { name }`.
4. Put model-readable text in `content`, typed render data in `structuredContent`, and View-only invocation data in `_meta`.
5. Destructure `useToolContext()` and handle pending, error, and ready states before reading `toolOutput`.
6. Replace aggregate UI methods with focused hooks.
7. Move CSP to `view.csp` and resolve public assets through the framework base.

## Remove transport and session assumptions

Treat callbacks as request-scoped and potentially concurrent. Replace active-session registries, session affinity, in-memory user identity, and post-response client targeting with request context or an external store. Use `ctx.client` only for self-reported capabilities and `ctx.auth` for verified identity.

Use `basePath` for the MCP endpoint path and `MCP_URL` for the externally visible public origin. Do not reconstruct public URLs from localhost assumptions.

## Migration checklist

1. Search source, tests, examples, and project documentation for the retired identifiers above.
2. Confirm public imports and registration signatures against the installed package.
3. Run type generation and typechecking before interpreting downstream errors.
4. Exercise every migrated tool, resource template, and prompt through a real client.
5. Render each migrated View and test pending, error, ready, interaction, asset, and CSP behavior.
6. Test authentication, notifications, and elicitation through supported clients when those boundaries changed.
7. Pack and import from a clean consumer when package exports or dependencies changed.

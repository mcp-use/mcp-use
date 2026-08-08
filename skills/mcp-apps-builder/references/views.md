# Views

## Layout and binding

Create `views/<name>/view.tsx`. Bind one rendering tool with `view: { name }`, declare its `outputSchema`, and return matching `structuredContent`.

The View is a React entry module. Do not add a provider wrapper just to access the host; the v2 runtime bootstraps the bridge.

## Rendering lifecycle

Use `useToolContext<"tool-name">()` and handle its discriminated states:

```tsx
const view = useToolContext<"search-products">();

if (view.status === "pending") {
  return <SearchSkeleton query={view.toolInput?.query} />;
}
if (view.status === "error") {
  return <ErrorBanner message={view.error.message} />;
}
return <Results items={view.toolOutput.items} />;
```

`toolInput` may be partial while pending. `toolOutput` is available only when ready.

## Focused hooks

- `useCallTool("tool-name")`: invoke an exported server tool with inferred input/output types.
- `useDynamicTool`: call a runtime-generated tool when no static exported ref exists.
- `useViewState`: persist JSON-serializable model-visible View state.
- `useHostContext`: inspect host capabilities and presentation context.
- `useDisplayMode`: request or inspect display mode when supported.
- `useSendFollowUp`: ask the host to continue the conversation.
- `ThemeProvider`: apply host-aware theme tokens.

Guard host-specific features with their support signal. Treat tool calls as asynchronous UI state: render pending and error states and preserve useful prior data where appropriate.

## CSP and assets

Declare external origins in the bound View's `csp` configuration. Keep local View code and CSS inside the View folder. Put shared public assets in `public/` and resolve them through the request-provided public asset base rather than hard-coded localhost URLs.

## Type generation

Export tool refs from the server entry so generated `RegisteredTools` types can connect View hook names to tool inputs and outputs. If a literal name is rejected, first confirm that the tool ref is exported and type generation has run.

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

Declare every external origin in the bound View's `csp` configuration. Use the
installed v2 types and the narrow field that matches the browser operation:

- `connectDomains` for `fetch`, EventSource, and WebSocket connections
- `resourceDomains` for scripts, styles, images, fonts, and media
- `frameDomains` for embedded frames
- `baseUriDomains` only when the View intentionally sets an external base URI

Use exact origins such as `https://api.example.com`, not paths. Keep the policy
least-privilege: never add `*`, leave Inspector in Permissive mode, or weaken the
host CSP to hide a violation. CORS is a separate server response contract and
must still be configured for cross-origin requests.

After rendering the View, enforce **Widget-Declared** mode and inspect the CSP
audit. In Vibe, use `chat_set_csp_mode` and `chat_read_csp_audit`; apply the
reported exact-origin suggestions to `view.csp`, render again, and repeat until
the audit reports `clean: true`. Also re-run `chat_read_runtime_errors` and take
a final screenshot. A successful tool result or a View that only works in
Permissive mode is not completion.

Keep local View code and CSS inside the View folder. Put shared public assets in
`public/` and resolve them through the request-provided public asset base rather
than hard-coded localhost URLs.

## Type generation

Export tool refs from the server entry so generated `RegisteredTools` types can connect View hook names to tool inputs and outputs. If a literal name is rejected, first confirm that the tool ref is exported and type generation has run.

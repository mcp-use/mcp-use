# Views

## Bind a View

Create `views/<name>/view.tsx`. Export the rendering tool ref, declare its `outputSchema`, bind `view: { name }`, and return matching `structuredContent`. The directory name and `view.name` must match exactly.

Use result `content` for a concise model-readable summary, `structuredContent` for typed render data, and `_meta` for invocation-specific data that should be visible only to the View.

## Read the rendering call

Destructure `useToolContext()` and narrow its discriminated lifecycle before reading `toolOutput`:

```tsx
import { useToolContext } from "mcp-use/react";

export default function ProductResults() {
  const { status, toolInput, toolOutput, error, meta } =
    useToolContext<"search-products">();

  if (status === "pending") {
    return <SearchSkeleton query={toolInput?.query} />;
  }

  if (status === "error") {
    return <ErrorBanner message={error.message} />;
  }

  const source = typeof meta?.source === "string" ? meta.source : undefined;
  return (
    <Results
      items={toolOutput.items}
      source={source}
    />
  );
}
```

`toolInput` may be partial while pending. Treat `meta` as untyped external data and validate or narrow it before use.

## Choose the interaction channel

- `useCallTool("tool-name")`: call an exported server tool with inferred types.
- `useDynamicTool`: call a runtime-generated tool when no static ref exists.
- `useSendFollowUp`: request a new model turn.
- `useOpenExternal`: ask the host to open a URL outside the sandbox.
- `useDisplayMode`: inspect and request a supported presentation mode.
- `useViewTool`: expose a temporary action that operates on the mounted UI.
- `useFiles`: use host file capabilities after checking support.

Guard host actions with `useHostContext()` capability signals. A host may reject or modify a request, so render pending and failure states and read the resulting host state.

## State and model context

- Use React state for ephemeral UI details the model does not need.
- Use `useViewState(objectDefault)` for JSON-serializable selections, filters, drafts, or progress that future model turns should understand.
- Use `<ModelContext content="...">` to describe currently visible UI declaratively.
- Store durable business data in the backend, not View state.

Do not put secrets or large render-only payloads into model-visible state. Keep `_uiContext` reserved for the runtime.

## Presentation, assets, and CSP

Use `ThemeProvider`, `ViewControls`, `useViewTheme`, or `viewConfig` only when their behavior is needed; the runtime bootstraps the host bridge and enables automatic resizing by default. A named `viewConfig` may restrict supported display modes or disable automatic resize.

Keep View code and CSS under its View folder. Put shared public files in `public/` and resolve them through the framework's public asset base rather than a hard-coded localhost URL.

Declare exact external origins in `view.csp`:

- `connectDomains` for fetch, EventSource, and WebSocket.
- `resourceDomains` for scripts, styles, images, fonts, and media.
- `frameDomains` for embedded frames.
- `baseUriDomains` only for an intentional external base URI.

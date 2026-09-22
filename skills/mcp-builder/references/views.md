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
  return <Results items={toolOutput.items} source={source} />;
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

## UI origin, endpoint identity, and host metadata

For SDK versions with automatic endpoint-based Claude domains, configure the UI
origin on the tool: `view: { name: "wave", domain: "https://wavebyvento.com" }`.
Set `MCP_URL=https://wave-by-vento.run.mcp-use.com` and server `basePath: "/mcp"`.
ChatGPT receives `ui.domain: "https://wavebyvento.com"`; Claude receives the first
32 hex characters of SHA-256 of the full `https://wave-by-vento.run.mcp-use.com/mcp`
endpoint plus `.claudemcpcontent.com`. Do not hash the website or asset origin.

Inspect the installed SDK: older versions hash `view.domain` itself. Upgrade to
endpoint-based handling before removing an existing compatibility helper. Do not
invent `uiOrigin` or `mcpEndpoint` config fields.

For View domain resolution, origin-only `MCP_URL` appends `basePath`; a URL with a
path is the full endpoint, preserved verbatim. With OAuth, use origin-only `MCP_URL`
because OAuth configuration requires it. Without `MCP_URL`, the SDK uses the request
path/query and forwarded/request origin. Set the public URL explicitly when a proxy
rewrites paths. `MCP_ASSETS_URL` controls assets, never Claude identity.

HTTP(S) `view.domain` URLs normalize to origins. Use an HTTPS origin without `/mcp`
for ChatGPT. Precomputed Claude domains remain supported but are Claude-only; replace
them with the UI origin for cross-host apps. Omitting `view.domain` keeps host defaults.
Without an HTTP request or `MCP_URL`, Claude falls back to the authored domain.

Remove helpers that overwrite generated resource `_meta.ui.domain` after `next()`;
they clobber Claude conversion. Preserve generated `ui` fields when adding unrelated
metadata. Configure the resource through `view.domain`, not tool `_meta` or tool
result `_meta`. Generated resources use standard `ui.domain` only. On manually authored
ChatGPT resources, `openai/widgetDomain` is an alias, not an override for an invalid
`ui.domain`; keep both consistent if both are emitted. Custom resources and response
middleware remain author-controlled.

`frameDomains` allows nested iframes inside the View. It does not set the View origin
or fix domain validation. Add it only for actual nested embeds.

Verify `resources/read` for ChatGPT and Claude, including an endpoint with `/mcp` and
a UI origin on another host. Claude detection uses advertised client name, falling
back to User-Agent when no name is present; unknown clients receive the UI origin.
Do not claim host publishing validation from SDK tests alone.

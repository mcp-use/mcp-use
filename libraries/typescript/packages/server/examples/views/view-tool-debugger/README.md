# View Tool Debugger example

Purpose-built `useViewTool` diagnostic surface. Unlike the tic-tac-toe demo,
there is no gameplay, follow-up prompting, or domain state machine between the
host and the bridge. The entire view is instrumentation.

## What is visible

- The complete server-tool → view context: status, input, structured output,
  content, view-only `_meta`, cancellation, and errors.
- Resolved host state: bridge availability, host identity and capabilities,
  raw host context, theme, locale, display mode, dimensions, and safe areas.
- The requested view-tool definition, including live title, description,
  annotations, schemas, and enabled state.
- Current React state, render count, handler call count, last validated input,
  last result or thrown error, and a 100-event chronological log.
- Console events prefixed with `[view-tool-debugger]` for comparison with the
  on-screen log.
- The built-in `ViewControls` debugger and display-mode controls.

## Tools

| Tool | Registered by | Called by | Purpose |
| --- | --- | --- | --- |
| `open-view-tool-debugger` | MCP server | host/model | Opens and seeds the diagnostic view |
| `debug-view-state` | `useViewTool` in the mounted view | host/model | Inspects or mutates the live React closure |

`debug-view-state` deliberately does **not** appear in the server's tool list
and cannot be called with `useCallTool`. It exists only while the view component
is mounted and must be invoked by a host that supports MCP Apps view tools.

## Suggested debug sequence

1. Call `open-view-tool-debugger`, optionally with `initialCounter` and `label`.
2. While the view is open, call `debug-view-state` with:

   ```json
   { "action": "inspect", "requestId": "call-1" }
   ```

3. Change the counter and note in the view, then call `inspect` again. The
   result's `stateBefore` proves whether the handler saw the latest React
   closure without re-registration.
4. Call `increment` with `amount`, or `set-note` with `note`, and compare the
   handler input, `stateBefore`, `stateAfter`, returned structured content,
   `_meta`, and event log.
5. Edit the title or description to exercise in-place metadata updates.
6. Disable the tool to exercise list/call behavior without unmounting it.
7. Try `return-error` and `throw-error` to compare both failure paths.

## Run locally

From this directory:

```sh
pnpm install
pnpm dev
```

The MCP endpoint is `http://127.0.0.1:3000/mcp`. The dev server log links to
the built-in inspector. Open the `view-tool-debugger` view by calling
`open-view-tool-debugger`, then leave it mounted while invoking
`debug-view-state`.

Production path:

```sh
pnpm build && pnpm start
```

Typecheck only:

```sh
pnpm typecheck
```

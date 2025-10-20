---
'@mcp-use/inspector': minor
'mcp-use': minor
---

Inspector and client updates to improve Apps SDK support and connection robustness.

### Inspector (Web UI)
- Add initial OpenAI Apps SDK component rendering in tool results via `openai/outputTemplate` metadata.
  - Fetch and render widget HTML inside a sandboxed iframe with dynamic height measurement.
  - Provide toggle between Component and Raw JSON views.
  - Persist widget data server-side and serve via new widget endpoints.
- Enhance Tools tab UX:
  - Saved Requests: save, load, and delete tool requests (stored in `localStorage`).
  - Keyboard navigation for tools and saved requests; improved search focus/expand behavior.
  - Response header shows timestamp and execution duration; quick copy button.
  - Better preview for MCP UI resources alongside JSON.
- Introduce `useSavedRequests` hook for reading updates to saved requests across tabs/windows.

### mcp-use (React)
- `useMcp` hook: add HTTP transport with automatic fallback to SSE (`transportType: 'auto' | 'http' | 'sse'`).
- Improve authentication flow with `BrowserOAuthClientProvider`, manual authenticate, and clearer error states.
- Add auto-retry and auto-reconnect behavior with configurable delays; richer structured logging.
- More robust resource/prompt/tool requests using SDK schemas and safer error handling.

### Server (Inspector)
- Add widget storage and content endpoints used by Apps SDK components in the inspector UI.

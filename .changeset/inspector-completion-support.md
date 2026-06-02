---
"@mcp-use/inspector": minor
---

feat(inspector): add completion/autocomplete support for prompts and resource templates (#1103)

Adds server-side autocomplete suggestions to the MCP Inspector UI when filling in:

- **Prompt arguments** — string-typed argument fields in the Prompts tab now show a dropdown of suggestions fetched via `completion/complete` as the user types. Requests are debounced (300 ms). Boolean, number, array, and object fields are unchanged.

- **Resource template URIs** — a new "Templates" sub-tab appears inside the Resources tab when the connected server exposes resource templates. Selecting a template shows one `CompletionInput` field per `{variable}` token in the URI, plus a live URI preview. Each field fetches suggestions from the server.

### New files
- `src/client/hooks/useCompletion.ts` — debounced wrapper around the MCP `complete()` API with graceful degradation (returns `[]` on error or when disconnected)
- `src/client/components/shared/CompletionInput.tsx` — reusable controlled input with async autocomplete dropdown, keyboard navigation, and loading indicator
- `src/client/components/resources/ResourceTemplatePanel.tsx` — panel for filling in and reading resource template URIs

### Modified files
- `PromptInputForm`, `PromptExecutionPanel`, `PromptsTab` — completion props threaded through the prompt execution stack
- `ResourcesTabHeader` — new Resources / Templates toggle tab row
- `ResourcesTab` — template list, template selection, completion integration
- `LayoutContent` — wires `selectedServer.complete` and `selectedServer.resourceTemplates` to the above components

### Tests
- `tests/unit/useCompletion.test.ts`
- `tests/unit/CompletionInput.test.tsx`
- `tests/unit/ResourceTemplatePanel.test.tsx`

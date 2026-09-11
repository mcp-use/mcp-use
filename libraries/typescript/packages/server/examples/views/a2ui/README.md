# Generative UI with A2UI

Ask for a UI in chat. The model calls `render-ui` with a layout and initial data,
and the stock **A2UI React renderer** displays it inside an mcp-use MCP App.
The model chooses the components and their arrangement on each call.

This follows the same pattern as the JSON-Render example: one rendering tool,
a small component catalog, and one view. A2UI supplies the renderer and local
data bindings. The server needs no model API key or agent runtime; the host chat
model generates the tool arguments.

## Run

From `libraries/typescript`, install and build the workspace if necessary:

```sh
pnpm install
pnpm build
pnpm --filter mcp-use-example-a2ui dev --port 3012
```

Open the printed Inspector URL, select **Chat**, and sign in with Manufact or
configure a supported model provider. Try:

> Make an interactive weekend reading dashboard with two book cards, a
> reading-goal slider, and a checklist. Let me edit the reader name.

Or:

> Build a packing checklist for a three-day beach trip, grouped into essentials
> and clothes, with an editable destination and a travel-style selector.

The app appears when the tool response completes. Inputs, checkboxes, sliders,
and choices edit local state. Components sharing a `/key` binding update
together. Edits are not saved and reset when the app is recreated; this example
does not implement submission, calculations, or server actions.

## Three pieces

- `src/index.ts`: the `render-ui` tool accepts and returns `{ spec }`.
- `views/generative-ui/catalog.ts`: the supported components and validation for
  IDs, references, bindings, and initial values.
- `views/generative-ui/view.tsx`: turn the spec into A2UI messages and render
  `<A2uiSurface>`. `view.css` supplies a small theme.

The catalog supports Text, Row, Column, Card, Divider, TextField, CheckBox,
Slider, and ChoicePicker. To extend it, add the matching A2UI component shape
to the schema and describe its use in the tool instructions.

The view passes standard A2UI v0.9 `createSurface`, `updateComponents`, and
`updateDataModel` messages to the processor. Everything travels through a normal
MCP tool response and MCP App; no AG-UI endpoint or first-party SDK adapter is
needed. A2UI's internal dependencies use Zod 3, while the tool schema uses Zod 4
for JSON Schema generation.

CopilotKit integration remains a separate follow-up: an MCP Apps host can load
this server-provided app with its embedded A2UI renderer. This example is tested
using the mcp-use Inspector.

## Check and build

```sh
pnpm --filter mcp-use-example-a2ui typecheck
pnpm --filter mcp-use-example-a2ui build
```

References: [A2UI React renderer](https://github.com/a2ui-project/a2ui/tree/main/renderers/react),
[A2UI inside MCP Apps](https://a2ui.org/guides/a2ui-in-mcp-apps/).

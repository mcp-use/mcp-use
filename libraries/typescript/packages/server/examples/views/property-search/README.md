# HomeScout SF: property search MCP App

An `mcp-use` MCP App with a Zillow-style split view: San Francisco listing
cards on one side and a live map with price pins on the other.
The model opens the view once with `search-homes`, then refines it in place
through tools the view registers itself.

All listings are fictional. Map tiles come from Esri's keyless Canvas basemaps
(light or dark gray, following the host theme). No listing API, API key, or
paid service is involved.

## Live demo

[Open the chat demo](https://inspector.manufact.com/inspector?embedded=true&autoConnect=https%3A%2F%2Fmanufact-property-search-example.run.mcp-use.com%2Fmcp&embeddedConfig=%7B%22singleTab%22%3Atrue%2C%22defaultTab%22%3A%22chat%22%2C%22visibleTabs%22%3A%5B%22chat%22%5D%7D)
and ask for homes in San Francisco. Select **Fullscreen** to see the listing
cards. The demo chat uses Manufact's managed model, which cannot call view
tools, so run the example locally to try follow-up refinements.

MCP endpoint: https://manufact-property-search-example.run.mcp-use.com/mcp

## Run

From `libraries/typescript`, install and build the workspace if necessary:

```sh
pnpm install
pnpm build
pnpm --filter mcp-use-example-views-property-search dev
```

A standalone copy you can clone and deploy lives at
[manufacts/mcp-use-property-search-example](https://github.com/manufacts/mcp-use-property-search-example).

Open the Inspector URL printed by the CLI, select **Chat**, and configure a
model provider with your own API key. The Inspector forwards view tools to the
model only in this mode; the managed Manufact model cannot call them. Try these
prompts in order:

1. "Show me homes in San Francisco."
2. "Now search the Mission, under $2M."
3. "Remove the two most expensive homes."
4. "Open the cheapest one on the map and save it."
5. "Zoom in one step."

The first prompt calls `search-homes` and opens the view. Every later prompt
calls a view tool, so the open map updates without rendering a second view.
Click **Fullscreen** in the view to switch display modes.

## How it works

`search-homes` returns the matching listing IDs plus the whole staged catalog in
`structuredContent`, so the view can filter any neighborhood locally. After it
renders, the view registers tools with `useViewTool` that filter, select, and
move the map.

| Tool | Called by | Purpose |
| --- | --- | --- |
| `search-homes` | Model | Open the view with an initial search |
| `get-listing-details` | View (app-only) | Load extra facts when a card or pin is selected |
| `search-in-view` | Model, via the view | Change area, price, beds, baths, home type, or sort in place |
| `remove-listings` | Model, via the view | Hide homes from the cards and map |
| `select-listing` | Model, via the view | Fly to a home and open its detail card |
| `save-listings` | Model, via the view | Save or unsave homes |
| `fit-visible-results` | Model, via the view | Fit every visible home in frame |
| `zoom-map` | Model, via the view | Zoom in or out |
| `pan-map` | Model, via the view | Pan north, south, east, or west |

The view also reports its current area, filters, and sort to the model with
`ModelContext`, and sends follow-up messages with `useSendFollowUp`.

The catalog covers Pacific Heights, Marina, Russian Hill, Nob Hill, Hayes
Valley, SoMa, Mission District, Noe Valley, Potrero Hill, and Bernal Heights.

- `src/index.ts`: the staged catalog, `search-homes`, and `get-listing-details`.
- `views/property-search/view.tsx`: the view, its view tools, and model context.
- `views/property-search/map.tsx`: the Leaflet map, Esri tiles, pins, and camera controls.
- `views/property-search/cards.tsx`: result cards and the detail panel.

## Check and build

```sh
pnpm --filter mcp-use-example-views-property-search typecheck
pnpm --filter mcp-use-example-views-property-search build
```

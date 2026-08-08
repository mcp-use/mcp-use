# HomeScout SF — MCP Apps property search

A polished V2 MCP Apps example with a Zillow-style split view: staged San
Francisco listings on the left and a self-contained interactive map on the
right. It uses no listing API, map tiles, paid service, or network assets.

## What it demonstrates

- A view-bound `search-homes` tool returns structured staged data and iframe
  HTML through the standard MCP Apps resource flow.
- The React iframe reads progressive tool input/result state with
  `useToolContext`, sends model-visible state through `ModelContext`, and uses
  `useSendFollowUp` for UI-to-host follow-up messages.
- `useCallTool("get-listing-details")` lets the iframe call an app-only MCP
  tool when a card or marker is selected.
- Six ephemeral `useViewTool` tools let the assistant/host manipulate the live
  view: `remove-listings`, `focus-neighborhood`, `zoom-map`, `pan-map`,
  `fit-visible-results`, and `select-listing`.
- The view requests standard `inline` and `fullscreen` display modes.
- Cards, map, house artwork, streets, and neighborhood metadata are entirely
  local. Every listing is fictional/staged.

The staged subset covers Nob Hill, Pacific Heights, Mission District, Hayes
Valley, Noe Valley, and SoMa. Neighborhood names can be passed naturally to
`search-homes`, selected in the UI, or focused in the already-open view using
`focus-neighborhood`.

## Run

From this directory:

```bash
npm install
npm run dev
```

Open the inspector URL printed by the CLI and connect to the local MCP server.
The default MCP endpoint is `/mcp`.

For a production-style self-contained build:

```bash
npm run build -- --inline
npm start
```

## Featured spoken demo

Use these prompts in order:

1. **"Pull up homes near San Francisco."**
   - Call `search-homes` with `location: "San Francisco"`.
   - The result opens with cards and the live map. Click **Fullscreen** to
     demonstrate host-controlled display mode.
2. **"The Clay Street and Fremont Street homes are too expensive. Remove them
   from the listing."**
   - Call the view tool `remove-listings` with
     `ids: ["clay-park", "fremont-sky"]`.
   - Both homes disappear immediately from cards and map, and `ModelContext`
     reports the updated staged result.
3. **"Now look for homes in Nob Hill."**
   - Call the live view tool `focus-neighborhood` with
     `neighborhood: "Nob Hill"` to filter and refocus without replacing the
     iframe. The same phrase also works as a fresh `search-homes` location.

Natural follow-ups that exercise the other view tools:

- "Zoom in one step."
- "Fit all the visible homes on the map."
- "Highlight the California Street condo."
- "Pan the map a little east."
- "Show me Pacific Heights / the Mission / Hayes Valley / Noe Valley / SoMa."

## Useful tool surface

| Tool | Caller | Purpose |
| --- | --- | --- |
| `search-homes` | model | Create the staged result and bind the view |
| `get-listing-details` | app | Load staged details from a card/marker click |
| `remove-listings` | view tool | Remove homes from cards, map, and model context |
| `focus-neighborhood` | view tool | Filter and focus a supported neighborhood |
| `zoom-map` | view tool | Zoom in or out |
| `pan-map` | view tool | Move the camera by relative coordinates |
| `fit-visible-results` | view tool | Fit the current result set |
| `select-listing` | view tool | Highlight a card and marker |

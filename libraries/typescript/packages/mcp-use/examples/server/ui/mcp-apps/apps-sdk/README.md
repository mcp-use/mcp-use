# Apps SDK example (slim)

This folder is a minimal **ChatGPT / Apps SDK**-oriented sample next to the main [`../`](../) MCP Apps example.

- **Server entry:** [`index.tsx`](./index.tsx) — uses **inline JSX** (`@jsxImportSource mcp-use/jsx`) and imports the shared [`../components/WeatherDisplay.tsx`](../components/WeatherDisplay.tsx).
- **`/api/fruits`** — static JSON used by older demos; the inline product-search UI now lives in the [create-mcp-use-app MCP Apps template](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/create-mcp-use-app/src/templates/mcp-apps).

For the full dual-protocol walkthrough, see [MCP Apps (TypeScript)](https://mcp-use.com/docs/typescript/server/mcp-apps) and [Migrating from resources/](https://mcp-use.com/docs/typescript/server/migration-from-resources).

## Run

```bash
pnpm install
pnpm dev
```

Then open the inspector and call **`get-current-weather`** or **`get-brand-info`**.

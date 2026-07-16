# OpenAPI server example

This example fetches the live National Weather Service OpenAPI document and
creates an MCP server from a small read-only subset of its operations:

```ts
const openapiSpec = await fetch("https://api.weather.gov/openapi.json").then(
  (response) => {
    if (!response.ok) {
      throw new Error(`Failed to fetch https://api.weather.gov/openapi.json: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }
);

const server = MCPServer.fromOpenAPI({
  spec: openapiSpec,
  baseUrl: "https://api.weather.gov",
  headers: {
    "User-Agent": "mcp-use-openapi-example/1.0",
  },
});
```

The generated tools call the public `api.weather.gov` endpoints directly. The
example keeps the tool list focused by registering only point metadata,
gridpoint forecasts, latest station observations, and active alerts by area.

## Run

From this directory:

```sh
pnpm dev
```

`mcp-use dev` imports `src/index.ts`, serves the default-exported server at
`http://127.0.0.1:3000/mcp`, and links the built-in inspector. The OpenAPI
document is fetched when the entry loads, so starting the example requires
internet access.

Set `WEATHER_USER_AGENT` to provide your own contact string for weather.gov
requests:

```sh
WEATHER_USER_AGENT="my-app/1.0 me@example.com" pnpm dev
```

To exercise the production path:

```sh
pnpm build && pnpm start
```

## Typecheck

```sh
pnpm typecheck
```

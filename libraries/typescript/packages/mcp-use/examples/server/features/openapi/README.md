# OpenAPI Server Example

This example fetches the live National Weather Service OpenAPI document and
creates an MCP server from a small read-only subset of its operations:

```ts
const openapiSpec = await fetch("https://api.weather.gov/openapi.json").then(
  (response) => response.json()
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

```sh
pnpm dev
```

Set `WEATHER_USER_AGENT` if you want to provide your own contact string for
weather.gov requests:

```sh
WEATHER_USER_AGENT="my-app/1.0 me@example.com" pnpm dev
```

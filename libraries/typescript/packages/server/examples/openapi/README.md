# OpenAPI server example

This example fetches the live National Weather Service OpenAPI document and
creates an MCP server from a small read-only subset of its operations:

```ts
import { MCPServer, type OpenAPIDocument } from "mcp-use";

const includedPaths = [
  "/points/{latitude},{longitude}",
  "/gridpoints/{wfo}/{x},{y}/forecast",
  "/stations/{stationId}/observations/latest",
  "/alerts/active/area/{area}",
] as const;

const openapiSpec = await fetch("https://api.weather.gov/openapi.json").then(
  async (response) => {
    if (!response.ok) {
      throw new Error(
        `Failed to fetch https://api.weather.gov/openapi.json: ${response.status} ${response.statusText}`
      );
    }

    const spec = (await response.json()) as OpenAPIDocument;
    const paths: NonNullable<OpenAPIDocument["paths"]> = {};
    for (const path of includedPaths) {
      const pathItem = spec.paths?.[path];
      if (pathItem === undefined) {
        throw new Error(`OpenAPI spec did not include expected path: ${path}`);
      }
      paths[path] = pathItem;
    }
    return { ...spec, paths };
  }
);

const server = MCPServer.fromOpenAPI({
  spec: openapiSpec,
  baseUrl: "https://api.weather.gov",
  headers: {
    "User-Agent":
      process.env.WEATHER_USER_AGENT ??
      "mcp-use-openapi-example/1.0 (https://github.com/mcp-use/mcp-use)",
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

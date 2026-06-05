import { MCPServer, type OpenAPIDocument } from "mcp-use/server";

const PORT = Number(process.env.PORT ?? 3010);
const WEATHER_API_BASE_URL = "https://api.weather.gov";
const WEATHER_OPENAPI_URL = `${WEATHER_API_BASE_URL}/openapi.json`;
const USER_AGENT =
  process.env.WEATHER_USER_AGENT ??
  "mcp-use-openapi-example/1.0 (https://github.com/mcp-use/mcp-use)";

// Keep the example focused: the full weather.gov spec would generate dozens of
// tools, which makes the inspector harder to scan for a quick OpenAPI demo.
const includedPaths = [
  "/points/{latitude},{longitude}",
  "/gridpoints/{wfo}/{x},{y}/forecast",
  "/stations/{stationId}/observations/latest",
  "/alerts/active/area/{area}",
] as const;

const openapiSpec = await loadWeatherOpenAPISpec();

const server = MCPServer.fromOpenAPI({
  spec: openapiSpec,
  baseUrl: WEATHER_API_BASE_URL,
  headers: {
    "User-Agent": USER_AGENT,
    Accept: "application/geo+json, application/json",
  },
  name: "National Weather Service",
});

await server.listen(PORT);

async function loadWeatherOpenAPISpec(): Promise<OpenAPIDocument> {
  const response = await fetch(WEATHER_OPENAPI_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${WEATHER_OPENAPI_URL}: ${response.status} ${response.statusText}`
    );
  }

  const spec = (await response.json()) as OpenAPIDocument;
  return pickPaths(spec, includedPaths);
}

function pickPaths(
  spec: OpenAPIDocument,
  paths: readonly string[]
): OpenAPIDocument {
  const sourcePaths = spec.paths ?? {};
  const pickedPaths: NonNullable<OpenAPIDocument["paths"]> = {};

  for (const path of paths) {
    const pathItem = sourcePaths[path];
    if (!pathItem) {
      throw new Error(`OpenAPI spec did not include expected path: ${path}`);
    }
    pickedPaths[path] = pathItem;
  }

  return {
    ...spec,
    paths: pickedPaths,
  };
}

import { describe, expect, it } from "vitest";
import { MCPServer } from "../../../src/server/index.js";
import {
  createClientCapabilityChecker,
  extractRequestClientMetadata,
} from "../../../src/server/tools/tool-execution-helpers.js";
import { transformInlineWidgets } from "../../../src/server/views/inline-widget-transform.js";

const MCP_UI_EXTENSION = "io.modelcontextprotocol/ui";
const MCP_UI_MIME = "text/html;profile=mcp-app";
const appsCapabilities = {
  extensions: {
    [MCP_UI_EXTENSION]: { mimeTypes: [MCP_UI_MIME] },
  },
};

describe("inline JSX transform manifest", () => {
  it("resolves imported components from arbitrary folders and captures static metadata", () => {
    const source = `
import { widget } from "mcp-use/server";
import WeatherCard from "../shared/ui/WeatherCard";

server.tool({ name: "get-weather" }, async () => {
  return jsx(WeatherCard, {
    city: city,
    _output: text("Weather ready"),
    _invoking: "Fetching weather...",
    _invoked: "Weather loaded",
    _csp: { connectDomains: ["https://api.example.com"] },
    _prefersBorder: false,
    _fileParams: ["file"],
    _domain: "https://widgets.example.com"
  });
});
`;

    const result = transformInlineWidgets(source, (specifier) =>
      specifier === "../shared/ui/WeatherCard"
        ? "/project/shared/ui/WeatherCard.tsx"
        : undefined
    );

    expect(result.changed).toBe(true);
    expect(result.code).toContain("widget({ props: { city: city }");
    expect(result.entries).toEqual([
      {
        toolName: "get-weather",
        widgetName: "weather-card",
        componentPath: "/project/shared/ui/WeatherCard.tsx",
        invoking: "Fetching weather...",
        invoked: "Weather loaded",
        csp: { connectDomains: ["https://api.example.com"] },
        prefersBorder: false,
        fileParams: ["file"],
        domain: "https://widgets.example.com",
      },
    ]);
  });

  it("adds widget imports from mcp-use/server", () => {
    const result = transformInlineWidgets(`
import WeatherCard from "./WeatherCard";

server.tool({ name: "get-weather" }, async () => {
  return jsx(WeatherCard, { _output: text("ok") });
});
`);

    expect(result.code).toContain('import { widget } from "mcp-use/server";');
  });
});

describe("request-scoped client metadata", () => {
  it("extracts capabilities from request _meta without session fallback", () => {
    expect(
      extractRequestClientMetadata({
        "mcp/clientCapabilities": appsCapabilities,
        "mcp/clientInfo": { name: "apps-client", version: "1.0.0" },
      })
    ).toEqual({
      clientCapabilities: appsCapabilities,
      clientInfo: { name: "apps-client", version: "1.0.0" },
    });

    expect(extractRequestClientMetadata(undefined)).toEqual({});
  });
});

describe("inline JSX tools/list metadata shaping", () => {
  it("adds inline view metadata only for Apps-capable requests", async () => {
    const server = new MCPServer({ name: "inline-test", version: "1.0.0" });
    server._inlineWidgetRegistry.set("get-weather", {
      toolName: "get-weather",
      widgetName: "weather-card",
      componentPath: "/project/shared/ui/WeatherCard.tsx",
      invoking: "Fetching weather...",
      invoked: "Weather loaded",
      prefersBorder: true,
    });
    server._ensureInlineWidgetMiddleware();

    const middleware = server.mcpMiddlewares.find(
      (entry: { pattern: string }) => entry.pattern === "tools/list"
    ).handler;
    const baseTool = {
      name: "get-weather",
      description: "Get weather",
      _meta: { custom: "keep", ui: { customUi: true } },
    };

    const appResult = await middleware(
      {
        method: "tools/list",
        params: { _meta: { clientCapabilities: appsCapabilities } },
        requestMeta: { clientCapabilities: appsCapabilities },
        clientCapabilities: appsCapabilities,
        client: createClientCapabilityChecker(appsCapabilities),
        state: new Map(),
      },
      async () => [baseTool]
    );

    expect(appResult[0]._meta.ui.resourceUri).toBe(
      "ui://widget/weather-card.html"
    );
    expect(appResult[0]._meta["openai/outputTemplate"]).toBe(
      "ui://widget/weather-card.html"
    );
    expect(appResult[0]._meta.custom).toBe("keep");

    const unknownResult = await middleware(
      {
        method: "tools/list",
        params: {},
        client: createClientCapabilityChecker(undefined),
        state: new Map(),
      },
      async () => [baseTool]
    );

    expect(unknownResult[0]._meta).toEqual({
      custom: "keep",
      ui: { customUi: true },
    });
    expect(baseTool._meta).toEqual({ custom: "keep", ui: { customUi: true } });
  });
});

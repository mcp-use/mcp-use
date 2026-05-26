/**
 * basePath + MCP Apps widget example.
 *
 * Demonstrates how `basePath` shifts every server-mounted route under a
 * common prefix, including:
 *   - the MCP transport at `${basePath}/mcp`
 *   - the inspector at `${basePath}/inspector`
 *   - widget asset URIs (`ui://...`) referenced from `_meta.ui.*`
 *
 * Visit:
 *   http://localhost:3000/api/inspector
 *   http://localhost:3000/api/mcp
 *
 * Call the `get-weather` tool from the inspector — the widget HTML is served
 * from `/api/_mcp-use/...`, automatically rewritten by the server based on
 * `basePath`. No client-side configuration is required.
 */

import { MCPServer, widget } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "base-path-mcp-apps-example",
  version: "1.0.0",
  description: "MCP server with MCP Apps widgets mounted under /api",
  basePath: "/api",
});

server.uiResource({
  type: "mcpApps",
  name: "weather-card",
  title: "Weather Card",
  description: "Shows current weather for a city",
  props: {
    city: { type: "string", required: true, description: "City name" },
    temperature: {
      type: "number",
      required: true,
      description: "Temperature in °C",
    },
    conditions: { type: "string", required: true, description: "Conditions" },
  },
  htmlTemplate: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        body { margin: 0; padding: 24px; font-family: system-ui, sans-serif; }
        .card {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 32px;
          border-radius: 12px;
          max-width: 360px;
        }
        .city { font-size: 14px; opacity: 0.85; text-transform: uppercase; letter-spacing: 1px; }
        .temp { font-size: 56px; font-weight: 700; margin: 8px 0; }
        .conditions { font-size: 18px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="city" id="city"></div>
        <div class="temp" id="temp"></div>
        <div class="conditions" id="conditions"></div>
      </div>
      <script>
        const params = new URLSearchParams(window.location.search);
        const props = JSON.parse(params.get('props') || '{}');
        document.getElementById('city').textContent = props.city || '—';
        document.getElementById('temp').textContent =
          props.temperature != null ? props.temperature + '°C' : '';
        document.getElementById('conditions').textContent = props.conditions || '';
      </script>
    </body>
    </html>
  `,
});

const weatherData: Record<
  string,
  { temperature: number; conditions: string }
> = {
  tokyo: { temperature: 22, conditions: "Partly Cloudy" },
  london: { temperature: 15, conditions: "Rainy" },
  paris: { temperature: 17, conditions: "Cloudy" },
};

server.tool(
  {
    name: "get-weather",
    description: "Get current weather for a city",
    schema: z.object({ city: z.string().describe("City name") }),
    widget: {
      name: "weather-card",
      invoking: "Fetching weather...",
      invoked: "Weather loaded",
    },
  },
  async ({ city }) => {
    const w = weatherData[city.toLowerCase()] ?? {
      temperature: 20,
      conditions: "Unknown",
    };
    return widget({
      props: { city, ...w },
      message: `Current weather in ${city}: ${w.conditions}, ${w.temperature}°C`,
    });
  }
);

await server.listen();

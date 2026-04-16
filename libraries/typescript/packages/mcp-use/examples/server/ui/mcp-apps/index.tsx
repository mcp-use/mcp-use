/** @jsxImportSource mcp-use/jsx */

/**
 * MCP APPS DUAL-PROTOCOL SUPPORT
 *
 * Demonstrates inline JSX tool returns with jsxImportSource mcp-use/jsx:
 * widgets are plain React components under `components/`; the server returns
 * `<WeatherDisplay ... _output={text(...)} />` instead of `widget()` + `resources/`.
 *
 * The programmatic `greeting-card` uiResource below still shows non-React MCP Apps HTML.
 */

import { MCPServer, object, text } from "mcp-use/server";
import { z } from "zod";
import { setTimeout as sleep } from "timers/promises";
import WeatherDisplay from "./components/WeatherDisplay";

const server = new MCPServer({
  name: "mcp-apps-example",
  version: "1.0.0",
  description:
    "Example MCP server demonstrating dual-protocol widget support (works with both ChatGPT and MCP Apps clients)",
});

const weatherCsp = {
  connectDomains: ["https://api.weather.com"],
  resourceDomains: [
    "https://cdn.weather.com",
    "https://soft-amber.local.mcp-use.run",
  ],
  scriptDirectives: ["'unsafe-eval'"] as string[],
};

// Mock weather data
const weatherData: Record<string, any> = {
  tokyo: {
    temperature: 22,
    conditions: "Partly Cloudy",
    humidity: 65,
    windSpeed: 12,
  },
  london: {
    temperature: 15,
    conditions: "Rainy",
    humidity: 80,
    windSpeed: 20,
  },
  "new york": {
    temperature: 18,
    conditions: "Sunny",
    humidity: 55,
    windSpeed: 8,
  },
  paris: {
    temperature: 17,
    conditions: "Cloudy",
    humidity: 70,
    windSpeed: 15,
  },
};

server.tool(
  {
    name: "get-weather",
    description:
      "Get current weather for a city (works with ChatGPT and MCP Apps clients)",
    schema: z.object({
      city: z.string().describe("City name"),
    }),
  },
  async ({ city }) => {
    const cityLower = city.toLowerCase();
    const weather = weatherData[cityLower] || {
      temperature: 20,
      conditions: "Unknown",
      humidity: 50,
      windSpeed: 10,
    };

    return (
      <WeatherDisplay
        city={city}
        temperature={weather.temperature}
        conditions={weather.conditions}
        humidity={weather.humidity}
        windSpeed={weather.windSpeed}
        _output={text(
          `Current weather in ${city}: ${weather.conditions}, ${weather.temperature}°C`
        )}
        _invoking="Fetching weather data..."
        _invoked="Weather data loaded"
        _csp={weatherCsp}
        _prefersBorder={true}
        _meta={{
          autoResize: true,
          widgetDescription:
            "Interactive weather card showing temperature and conditions",
          annotations: { readOnlyHint: true },
        }}
      />
    );
  }
);

server.tool(
  {
    name: "get-weather-delayed",
    description:
      "Get weather with artificial 5-second delay to test widget lifecycle (Issue #930)",
    schema: z.object({
      city: z.string().describe("City name"),
      delay: z
        .number()
        .default(5000)
        .describe("Delay in milliseconds (default = 5000)"),
    }),
  },
  async ({ city, delay }) => {
    await sleep(delay);

    const cityLower = city.toLowerCase();
    const weather = weatherData[cityLower] || {
      temperature: 20,
      conditions: "Unknown",
      humidity: 50,
      windSpeed: 10,
    };

    return (
      <WeatherDisplay
        city={city}
        temperature={weather.temperature}
        conditions={weather.conditions}
        humidity={weather.humidity}
        windSpeed={weather.windSpeed}
        _output={text(
          `Current weather in ${city}: ${weather.conditions}, ${weather.temperature}°C (fetched after ${delay}ms delay)`
        )}
        _invoking="Fetching weather data..."
        _invoked="Weather data loaded"
        _csp={weatherCsp}
        _prefersBorder={true}
        _meta={{
          autoResize: true,
          widgetDescription:
            "Interactive weather card showing temperature and conditions",
          annotations: { readOnlyHint: true },
        }}
      />
    );
  }
);

server.uiResource({
  type: "mcpApps",
  name: "greeting-card",
  title: "Greeting Card",
  description: "Shows a personalized greeting message",
  props: {
    name: {
      type: "string",
      required: true,
      description: "Name to greet",
    },
    greeting: {
      type: "string",
      required: true,
      description: "Greeting message",
    },
  },
  htmlTemplate: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          margin: 0;
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .greeting-card {
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          border-radius: 12px;
          padding: 32px;
          color: white;
          text-align: center;
          max-width: 400px;
        }
        .greeting {
          font-size: 36px;
          font-weight: 700;
          margin-bottom: 16px;
        }
        .name {
          font-size: 48px;
          font-weight: 800;
        }
      </style>
    </head>
    <body>
      <div class="greeting-card">
        <div class="greeting" id="greeting">Hello</div>
        <div class="name" id="name">World</div>
      </div>
      <script>
        const params = new URLSearchParams(window.location.search);
        const propsJson = params.get('props');
        if (propsJson) {
          try {
            const props = JSON.parse(propsJson);
            document.getElementById('greeting').textContent = props.greeting || 'Hello';
            document.getElementById('name').textContent = props.name || 'World';
          } catch (e) {
            console.error('Failed to parse props:', e);
          }
        }
      </script>
    </body>
    </html>
  `,
  metadata: {
    prefersBorder: true,
    widgetDescription: "A colorful greeting card with personalized message",
  },
  exposeAsTool: true,
});

server.tool(
  {
    name: "get-info",
    description: "Get information about MCP Apps dual-protocol support",
  },
  async () =>
    object({
      feature: "MCP Apps Dual-Protocol Support",
      description:
        "Single widget definition works with both ChatGPT and MCP Apps clients",
      protocols: {
        chatgpt: {
          name: "OpenAI Apps SDK",
          mimeType: "text/html+skybridge",
          metadata: "openai/* prefixed keys (snake_case CSP)",
        },
        mcpApps: {
          name: "MCP Apps Extension (SEP-1865)",
          mimeType: "text/html;profile=mcp-app",
          metadata: "_meta.ui.* namespace (camelCase CSP)",
        },
      },
      benefits: [
        "Write once, run anywhere",
        "Automatic protocol detection",
        "Backward compatible with existing Apps SDK widgets",
        "Based on official MCP Apps Extension standard",
      ],
    })
);

await server.listen();

console.log(`
MCP Apps Example Server Started

Weather tools use inline JSX + components/WeatherDisplay.tsx (no resources/ widget folder).

Try:
- get-weather / get-weather-delayed
- greeting-display (programmatic HTML uiResource)
- get-info
`);

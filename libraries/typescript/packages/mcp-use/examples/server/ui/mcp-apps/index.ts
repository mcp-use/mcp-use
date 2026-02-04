import { MCPServer, object, widget } from "mcp-use/server";
import { z } from "zod";
import { setTimeout as sleep } from "timers/promises";

const server = new MCPServer({
  name: "mcp-apps-example",
  version: "1.0.0",
  description:
    "Example MCP server demonstrating dual-protocol widget support (works with both ChatGPT and MCP Apps clients)",
});

/**
 * MCP APPS DUAL-PROTOCOL SUPPORT
 *
 * This example demonstrates dual-protocol widget support that works with BOTH:
 * - ChatGPT (using Apps SDK protocol)
 * - MCP Apps-compatible clients like Claude, Goose, etc. (using MCP Apps Extension)
 *
 * The server automatically generates metadata for both protocols, so your widget
 * works everywhere without code changes!
 *
 * NOTE: The weather-display widget is defined as a React component in resources/weather-display/widget.tsx
 * It's automatically discovered and registered during server startup.
 */

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

// Custom tool that uses the weather widget
server.tool(
  {
    name: "get-weather",
    description:
      "Get current weather for a city (works with ChatGPT and MCP Apps clients)",
    schema: z.object({
      city: z.string().describe("City name"),
    }),
    widget: {
      name: "weather-display",
      invoking: "Fetching weather data...",
      invoked: "Weather data loaded",
    },
  },
  async ({ city }) => {
    const cityLower = city.toLowerCase();
    const weather = weatherData[cityLower] || {
      temperature: 20,
      conditions: "Unknown",
      humidity: 50,
      windSpeed: 10,
    };

    return widget({
      props: {
        city,
        ...weather,
      },
      message: `Current weather in ${city}: ${weather.conditions}, ${weather.temperature}°C`,
    });
  }
);

// Delayed weather tool to test widget lifecycle (Issue #930)
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
        .describe("Delay in milliseconds (default: 5000)"),
    }),
    widget: {
      name: "weather-display",
      invoking: "Fetching weather data...",
      invoked: "Weather data loaded",
    },
  },
  async ({ city, delay }) => {
    // Simulate slow API call
    await sleep(delay);

    const cityLower = city.toLowerCase();
    const weather = weatherData[cityLower] || {
      temperature: 20,
      conditions: "Unknown",
      humidity: 50,
      windSpeed: 10,
    };

    return widget({
      props: {
        city,
        ...weather,
      },
      message: `Current weather in ${city}: ${weather.conditions}, ${weather.temperature}°C (fetched after ${delay}ms delay)`,
    });
  }
);

// Example 2: Simple greeting widget (programmatic, auto-exposed as tool)
// NOTE: You can also create React widgets in resources/ directory like weather-display
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
        // Parse props from URL (for both protocols)
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
  // This widget is automatically exposed as a tool
  exposeAsTool: true,
});

// Brand info tool (returns structured data)
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
🚀 MCP Apps Example Server Started!

This server demonstrates dual-protocol widget support:

✅ Works with ChatGPT (Apps SDK)
✅ Works with MCP Apps clients (Claude, Goose, etc.)

Try these tools:
- get-weather: Get weather for a city (uses weather-display widget)
- get-weather-delayed: Test widget lifecycle with 5s delay (Issue #930)
- greeting-display: Auto-exposed widget with props
- get-info: Learn about dual-protocol support

To test Issue #930 fix:
1. Call get-weather-delayed with city="Paris"
2. Widget should appear immediately showing loading state
3. After 5 seconds, widget updates with weather data
`);

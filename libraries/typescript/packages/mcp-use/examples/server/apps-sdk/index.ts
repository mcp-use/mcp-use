import { MCPServer, object, widget } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "test-app",
  version: "1.0.0",
  description: "Test MCP server with automatic UI widget registration",
});

/**
 * AUTOMATIC UI WIDGET REGISTRATION
 * All React components in the `resources/` folder are automatically registered as MCP tools and resources.
 * Just export widgetMetadata with description and Zod schema, and mcp-use handles the rest!
 *
 * The product-search-result widget will automatically be registered as:
 * - server.tool('product-search-result')
 * - server.resource('ui://widget/product-search-result')
 *
 * The weather-display widget has exposeAsTool: false, so it's only registered as:
 * - server.resource('ui://widget/weather-display')
 *
 * We then create custom tools that use the weather-display widget manually.
 *
 * See docs: https://docs.mcp-use.com/typescript/server/ui-widgets
 */

// API endpoint for fruits data
server.get("/api/fruits", (c) => {
  return c.json([
    { fruit: "mango", color: "bg-[#FBF1E1] dark:bg-[#FBF1E1]/10" },
    { fruit: "pineapple", color: "bg-[#f8f0d9] dark:bg-[#f8f0d9]/10" },
    { fruit: "cherries", color: "bg-[#E2EDDC] dark:bg-[#E2EDDC]/10" },
    { fruit: "coconut", color: "bg-[#fbedd3] dark:bg-[#fbedd3]/10" },
    { fruit: "apricot", color: "bg-[#fee6ca] dark:bg-[#fee6ca]/10" },
    { fruit: "blueberry", color: "bg-[#e0e6e6] dark:bg-[#e0e6e6]/10" },
    { fruit: "grapes", color: "bg-[#f4ebe2] dark:bg-[#f4ebe2]/10" },
    { fruit: "watermelon", color: "bg-[#e6eddb] dark:bg-[#e6eddb]/10" },
    { fruit: "orange", color: "bg-[#fdebdf] dark:bg-[#fdebdf]/10" },
    { fruit: "avocado", color: "bg-[#ecefda] dark:bg-[#ecefda]/10" },
    { fruit: "apple", color: "bg-[#F9E7E4] dark:bg-[#F9E7E4]/10" },
    { fruit: "pear", color: "bg-[#f1f1cf] dark:bg-[#f1f1cf]/10" },
    { fruit: "plum", color: "bg-[#ece5ec] dark:bg-[#ece5ec]/10" },
    { fruit: "banana", color: "bg-[#fdf0dd] dark:bg-[#fdf0dd]/10" },
    { fruit: "strawberry", color: "bg-[#f7e6df] dark:bg-[#f7e6df]/10" },
    { fruit: "lemon", color: "bg-[#feeecd] dark:bg-[#feeecd]/10" },
  ]);
});

// Brand Info Tool - Returns structured data
server.tool(
  {
    name: "get-brand-info",
    description:
      "Get information about the brand, including company details, mission, and values",
  },
  async () =>
    object({
      name: "mcp-use",
      tagline: "Build MCP servers with UI widgets in minutes",
      description:
        "mcp-use is a modern framework for building Model Context Protocol (MCP) servers with automatic UI widget registration, making it easy to create interactive AI tools and resources.",
      founded: "2025",
      mission:
        "To simplify the development of MCP servers and make AI integration accessible for developers",
      values: [
        "Developer Experience",
        "Simplicity",
        "Performance",
        "Open Source",
        "Innovation",
      ],
      contact: {
        website: "https://mcp-use.com",
        docs: "https://docs.mcp-use.com",
        github: "https://github.com/mcp-use/mcp-use",
      },
      features: [
        "Automatic UI widget registration",
        "React component support",
        "Full TypeScript support",
        "Built-in HTTP server",
        "MCP protocol compliance",
      ],
    })
);

/**
 * CUSTOM TOOLS WITH MANUAL WIDGET USAGE
 *
 * The weather-display widget has exposeAsTool: false, so it's not automatically
 * registered as a tool. Instead, we create custom tools that fetch data and
 * then use the widget() helper to display it.
 *
 * This pattern is useful when you want:
 * - Custom logic before showing the widget
 * - Different tool parameters than widget props
 * - One widget used by multiple tools
 * - To combine data from multiple sources
 */

// Mock weather data for demo purposes
const weatherData: Record<string, any> = {
  tokyo: {
    temperature: 22,
    conditions: "partly cloudy",
    humidity: 65,
    windSpeed: 12,
  },
  london: { temperature: 15, conditions: "rainy", humidity: 80, windSpeed: 20 },
  "new york": {
    temperature: 18,
    conditions: "sunny",
    humidity: 55,
    windSpeed: 8,
  },
  paris: { temperature: 17, conditions: "cloudy", humidity: 70, windSpeed: 15 },
  sydney: { temperature: 25, conditions: "sunny", humidity: 60, windSpeed: 10 },
};

// Get current weather - uses the weather-display widget
server.tool(
  {
    name: "get-current-weather",
    description: "Get current weather for a city",
    schema: z.object({ city: z.string() }),
  },
  async ({ city }) => {
    // Fetch weather data (mock for demo)
    const cityLower = city.toLowerCase();
    const weather = weatherData[cityLower] || {
      temperature: 20,
      conditions: "unknown",
      humidity: 50,
      windSpeed: 10,
    };

    // Return widget with the fetched data
    return widget({
      name: "weather-display",
      data: {
        city,
        temperature: weather.temperature,
        conditions: weather.conditions,
        humidity: weather.humidity,
        windSpeed: weather.windSpeed,
      },
      message: `Current weather in ${city}`,
      invoking: "Fetching weather data...",
      invoked: "Weather data loaded",
    });
  }
);

// Get weather forecast - also uses the weather-display widget
server.tool(
  {
    name: "get-weather-forecast",
    description: "Get weather forecast for tomorrow in a city",
    inputs: {
      city: {
        type: "string",
        description: "The city name",
      },
    },
  },
  async ({ city }: { city: string }) => {
    // Fetch forecast data (mock - add 3 degrees for tomorrow)
    const cityLower = city.toLowerCase();
    const today = weatherData[cityLower] || {
      temperature: 20,
      conditions: "unknown",
      humidity: 50,
      windSpeed: 10,
    };

    const tomorrow = {
      temperature: today.temperature + 3,
      conditions: "sunny",
      humidity: today.humidity - 5,
      windSpeed: today.windSpeed + 2,
    };

    // Return widget with the forecast data
    return widget({
      name: "weather-display",
      data: {
        city: `${city} (Tomorrow)`,
        temperature: tomorrow.temperature,
        conditions: tomorrow.conditions,
        humidity: tomorrow.humidity,
        windSpeed: tomorrow.windSpeed,
      },
      message: `Weather forecast for ${city}`,
      invoking: "Fetching forecast...",
      invoked: "Forecast loaded",
    });
  }
);

await server.listen();

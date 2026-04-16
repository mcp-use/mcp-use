/** @jsxImportSource mcp-use/jsx */

/**
 * Slim ChatGPT / Apps SDK–oriented server: inline JSX weather widget (see parent components/).
 */

import { MCPServer, object, text } from "mcp-use/server";
import { z } from "zod";
import WeatherDisplay from "../components/WeatherDisplay";

const server = new MCPServer({
  name: "test-app",
  version: "1.0.0",
  description: "MCP server with MCP Apps inline JSX widgets",
});

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
        docs: "https://mcp-use.com/docs",
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

const weatherCsp = {
  connectDomains: ["https://api.weather.com"],
  resourceDomains: ["https://cdn.weather.com"],
  scriptDirectives: ["'unsafe-eval'"] as string[],
};

server.tool(
  {
    name: "get-current-weather",
    description: "Get current weather for a city",
    schema: z.object({ city: z.string() }),
  },
  async ({ city }) => {
    const cityLower = city.toLowerCase();
    const weather = weatherData[cityLower] || {
      temperature: 20,
      conditions: "unknown",
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
        _output={text(`Current weather in ${city}`)}
        _invoking="Fetching weather data..."
        _invoked="Weather data loaded"
        _csp={weatherCsp}
        _prefersBorder={true}
        _meta={{
          autoResize: true,
          annotations: { readOnlyHint: true },
        }}
      />
    );
  }
);

await server.listen();

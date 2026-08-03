import { MCPServer } from "mcp-use";
import { z } from "zod";

/** Create the weather server mounted under the `weather` namespace. */
export function createWeatherServer(): MCPServer {
  const server = new MCPServer({
    name: "weather-upstream",
    version: "1.0.0",
  });

  server.tool(
    {
      name: "forecast",
      description: "Return a sample forecast for a city.",
      inputSchema: z.object({ city: z.string() }),
    },
    async ({ city }) => ({
      content: [
        {
          type: "text",
          text: `${city}: 21°C, clear skies`,
        },
      ],
    })
  );

  server.prompt(
    {
      name: "plan_trip",
      description: "Create a prompt for planning around the weather.",
      schema: z.object({ city: z.string() }),
    },
    async ({ city }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Plan a one-day trip to ${city} for clear, 21°C weather.`,
          },
        },
      ],
    })
  );

  return server;
}

/** Create the inventory server mounted under the `inventory` namespace. */
export function createInventoryServer(): MCPServer {
  const server = new MCPServer({
    name: "inventory-upstream",
    version: "1.0.0",
  });

  server.tool(
    {
      name: "find_product",
      description: "Look up a sample product by SKU.",
      inputSchema: z.object({ sku: z.string() }),
    },
    async ({ sku }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ sku, name: "Travel umbrella", inStock: true }),
        },
      ],
    })
  );

  server.resource(
    {
      name: "featured_product",
      uri: "inventory://featured",
      description: "The featured product in the sample inventory.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            sku: "UMBRELLA-01",
            name: "Travel umbrella",
            inStock: true,
          }),
        },
      ],
    })
  );

  return server;
}

import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "acme-weather",
  title: "Acme Weather",
  version: "1.0.0",
  description: "Forecasts and alerts for any city, from your AI client.",
});

server.tool(
  {
    name: "get-forecast",
    title: "Get forecast",
    description: "Return a 3-day demo forecast for a city.",
    inputSchema: z.object({ city: z.string() }),
  },
  async ({ city }) => ({
    content: [{ type: "text", text: `${city}: sunny, 22°C for 3 days` }],
  })
);

server.tool(
  {
    name: "get-alerts",
    title: "Get alerts",
    description: "List active weather alerts for a region.",
    inputSchema: z.object({ region: z.string() }),
  },
  async ({ region }) => ({
    content: [{ type: "text", text: `No active alerts in ${region}.` }],
  })
);

server.tool(
  {
    name: "convert-units",
    description: "Convert a temperature between Celsius and Fahrenheit.",
    inputSchema: z.object({
      value: z.number(),
      to: z.enum(["C", "F"]),
    }),
  },
  async ({ value, to }) => ({
    content: [
      {
        type: "text",
        text: String(to === "F" ? (value * 9) / 5 + 32 : ((value - 32) * 5) / 9),
      },
    ],
  })
);

server.prompt(
  {
    name: "plan-trip",
    description: "Plan a day around the forecast for a city.",
    schema: z.object({ city: z.string() }),
  },
  async ({ city }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `Plan my day in ${city} using the forecast.` },
      },
    ],
  })
);

export default server;

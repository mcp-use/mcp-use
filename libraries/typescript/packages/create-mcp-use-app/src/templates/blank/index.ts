import { MCPServer } from "mcp-use/server";

const server = new MCPServer({
  name: "{{PROJECT_NAME}}",
  title: "{{PROJECT_NAME}}", // display name
  version: "1.0.0",
  description: "Blank mcp-use server",
  baseUrl: process.env.MCP_URL || "http://localhost:3000", // Full base URL (e.g., https://myserver.com)
  favicon: "favicon.ico",
  websiteUrl: "https://mcp-use.com", // Can be customized later
  icons: [
    {
      src: "icon.svg",
      mimeType: "image/svg+xml",
      sizes: ["512x512"],
    },
  ],
});

/**
 * Define MCP tools
 * Docs: https://mcp-use.com/docs/typescript/server/tools
 *
 * Response helpers (`text`, `object`, `image`, `markdown`, `html`, `error`,
 * `widget`, ...) are exported from `mcp-use/server`.

import { object } from "mcp-use/server";
import { z } from "zod";

server.tool(
  {
    name: "fetch-weather",
    description: "Fetch the weather for a city",
    schema: z.object({
      city: z.string().describe("The city to fetch the weather for"),
    }),
    outputSchema: z.object({
      city: z.string(),
      conditions: z.string(),
      temperatureCelsius: z.number(),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ city }) => {
    const weather = {
      city,
      conditions: "sunny",
      temperatureCelsius: 22,
    };

    return object(weather);
  }
);
 */

/*
 * Define MCP resources
 * Docs: https://mcp-use.com/docs/typescript/server/resources

import { object } from "mcp-use/server";

server.resource(
  {
    name: "config",
    uri: "config://settings",
    description: "Server configuration",
  },
  async () =>
    object({
      theme: "dark",
      language: "en",
    })
);
*/

/*
 * Define MCP prompts
 * Docs: https://mcp-use.com/docs/typescript/server/prompts

import { text } from "mcp-use/server";
import { z } from "zod";

server.prompt(
  {
    name: "review-code",
    description: "Review code for best practices and potential issues",
    schema: z.object({
      code: z.string().describe("The code to review"),
    }),
  },
  async ({ code }) => {
    return text(`Please review this code:\n\n${code}`);
  }
); */

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;
console.log(`Server running on port ${PORT}`);
server.listen(PORT);

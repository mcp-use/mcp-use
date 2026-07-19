import { completable, MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "{{PROJECT_NAME}}",
  title: "{{PROJECT_NAME}}",
  version: "1.0.0",
  description: "An MCP server built with mcp-use",
});

server.tool(
  {
    name: "fetch-weather",
    description: "Return demo weather for a city",
    inputSchema: z.object({ city: z.string() }),
    outputSchema: z.object({
      city: z.string(),
      conditions: z.string(),
      temperature: z.string(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ city }) => {
    const weather = { city, conditions: "sunny", temperature: "22°C" };
    return {
      content: [{ type: "text", text: JSON.stringify(weather) }],
      structuredContent: weather,
    };
  }
);

server.prompt(
  {
    name: "review-code",
    description: "Review code for correctness and maintainability",
    schema: z.object({
      language: completable(z.string(), [
        "typescript",
        "javascript",
        "python",
        "go",
      ]),
      code: z.string(),
    }),
  },
  async ({ language, code }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Review this ${language} code:\n\n${code}`,
        },
      },
    ],
  })
);

export default server;

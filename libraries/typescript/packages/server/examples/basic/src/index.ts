import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "basic-example",
  version: "1.0.0",
  description: "The smallest useful mcp-use server.",
});

export const greet = server.tool(
  {
    name: "greet",
    description: "Return a friendly greeting.",
    inputSchema: z.object({ name: z.string().default("world") }),
  },
  async ({ name }) => ({ content: [{ type: "text", text: `Hello, ${name}!` }] })
);

server.resource({ name: "about", uri: "example://about" }, async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: "text/plain",
      text: "This resource belongs to the basic mcp-use example.",
    },
  ],
}));

server.prompt(
  { name: "introduce", schema: z.object({ name: z.string() }) },
  async ({ name }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `Introduce yourself to ${name}.` },
      },
    ],
  })
);

// Export the server; `mcp-use dev`, `build`, and `start` own the HTTP listener.
export default server;

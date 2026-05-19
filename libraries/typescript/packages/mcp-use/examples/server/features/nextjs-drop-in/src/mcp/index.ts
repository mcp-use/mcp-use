import { MCPServer, text, widget } from "mcp-use/server";
import z from "zod";
import { getGreeting, sampleItems } from "@/lib/server-data";

const server = new MCPServer({
  name: "nextjs-drop-in-example",
  version: "1.0.0",
  description:
    "Next.js drop-in MCP server. Imports @/lib/server-data which pulls in server-only + next/headers to prove the CLI shim layer is active.",
});

server.tool(
  {
    name: "greet",
    description:
      "Return a greeting from @/lib/server-data (which imports server-only + next/headers).",
    schema: z.object({
      name: z.string().describe("Name to greet"),
    }),
  },
  async ({ name }) => text(await getGreeting(name))
);

server.tool(
  {
    name: "show-items",
    description:
      "Render the items exported from @/lib/server-data using the items-widget React widget.",
    schema: z.object({
      name: z.string().default("world").describe("Name to greet in the widget"),
    }),
    widget: {
      name: "items-widget",
      invoking: "Loading items...",
      invoked: "Items loaded",
    },
  },
  async ({ name }) =>
    widget({
      props: {
        greeting: await getGreeting(name),
        items: sampleItems,
      },
      message: `Rendered ${sampleItems.length} items for ${name}.`,
    })
);

await server.listen();

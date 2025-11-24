import { createMCPServer } from "mcp-use/server";
import { cors } from 'hono/cors';

const server = createMCPServer("test-app", {
  version: "1.0.0",
  description: "Test MCP server with automatic UI widget registration",
});

server.use(
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Length"],
    maxAge: 86400,
    credentials: false,
  })
);

/**
 * AUTOMATIC UI WIDGET REGISTRATION
 * All React components in the `resources/` folder are automatically registered as MCP tools and resources.
 * Just export widgetMetadata with description and Zod schema, and mcp-use handles the rest!
 *
 * It will automatically add to your MCP server:
 * - server.tool('get-brand-info')
 * - server.resource('ui://widget/get-brand-info')
 *
 * See docs: https://docs.mcp-use.com/typescript/server/ui-widgets
 */

/**
 * Add here your standard MCP tools, resources and prompts
 */

// Fruits data for the API
const fruits = [
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
];

// API endpoint for fruits data
server.get("/api/fruits", (c) => {
  return c.json(fruits);
});

// Brand Info Tool - Returns brand information
server.tool({
  name: "get-brand-info",
  description:
    "Get information about the brand, including company details, mission, and values",
  cb: async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              name: "mcp-use",
              tagline: "Build MCP servers with UI widgets in minutes",
              description:
                "mcp-use is a modern framework for building Model Context Protocol (MCP) servers with automatic UI widget registration, making it easy to create interactive AI tools and resources.",
              founded: "2024",
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
            },
            null,
            2
          ),
        },
      ],
    };
  },
});

server.listen().then(() => {
  console.log(`Server running`);
});

import { MCPServer } from "mcp-use";
import { z } from "zod";

const products = [
  {
    id: "ceramic-mug",
    name: "Ceramic Mug",
    description: "A handmade stoneware mug for coffee or tea.",
    price: 24,
    emoji: "☕",
  },
  {
    id: "canvas-tote",
    name: "Canvas Tote",
    description: "A sturdy everyday tote made from recycled canvas.",
    price: 18,
    emoji: "👜",
  },
  {
    id: "desk-lamp",
    name: "Desk Lamp",
    description: "A compact warm-light lamp with a dimmer.",
    price: 49,
    emoji: "💡",
  },
] as const;

const server = new MCPServer({
  name: "view-state-store",
  version: "1.0.0",
  title: "View State Store",
  legacy: "stateless",
  description: "A small ecommerce carousel with a model-visible cart.",
  basePath: "/mcp",
});

export const openStore = server.tool(
  {
    name: "open-store",
    title: "Open store",
    description: "Open a small product carousel where the user can shop.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      products: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          price: z.number(),
          emoji: z.string(),
        })
      ),
    }),
    view: {
      name: "store",
      description: "A product carousel with a shopping cart",
      prefersBorder: true,
    },
  },
  async () => ({
    content: [{ type: "text", text: "Opened the product carousel." }],
    structuredContent: { products: [...products] },
  })
);

export default server;

/** @jsxImportSource mcp-use/jsx */

import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";
import ContextDemo from "./components/ContextDemo";

/**
 * MODEL CONTEXT EXAMPLE — inline JSX + components/ContextDemo.tsx
 */

const server = new MCPServer({
  name: "model-context-example",
  version: "1.0.0",
  description:
    "Demonstrates ModelContext and modelContext APIs for keeping the AI aware of widget UI state",
});

const products = [
  { id: "1", name: "Wireless Headphones", price: 79.99, category: "Audio" },
  { id: "2", name: "Mechanical Keyboard", price: 129.99, category: "Input" },
  { id: "3", name: "USB-C Hub", price: 49.99, category: "Accessories" },
  { id: "4", name: "Webcam HD", price: 89.99, category: "Video" },
  { id: "5", name: "Monitor Stand", price: 39.99, category: "Furniture" },
];

server.tool(
  {
    name: "browse-products",
    description:
      "Open an interactive product browser. The widget uses ModelContext to keep the AI aware of which tab the user is on, which product they are hovering, and which product they have selected.",
    schema: z.object({
      category: z
        .string()
        .optional()
        .describe(
          "Pre-select a category tab (Audio, Input, Accessories, Video, Furniture)"
        ),
    }),
  },
  async ({ category }) => {
    return (
      <ContextDemo
        products={products}
        initialCategory={category ?? null}
        _output={text(
          `Product browser opened${category ? ` on the ${category} tab` : ""}. The widget is now tracking what the user is viewing.`
        )}
        _invoking="Loading product browser..."
        _invoked="Product browser ready"
        _prefersBorder={true}
        _meta={{ autoResize: true }}
      />
    );
  }
);

await server.listen();

console.log(`
Model Context Example — try: browse-products
`);

import { MCPServer, widget } from "mcp-use/server";
import { z } from "zod";

/**
 * MODEL CONTEXT EXAMPLE
 *
 * Demonstrates how widgets can annotate what the user is currently viewing
 * so the AI model stays aware of UI state without requiring explicit tool calls.
 *
 * Two complementary APIs are shown in the widget:
 *
 * 1. <ModelContext> component — declarative, lifecycle-tied, tree-aware
 *    Used to annotate sections of the UI that are rendered in JSX.
 *
 * 2. modelContext.set() / modelContext.remove() — imperative module-level API
 *    Used from event handlers and other non-JSX code.
 *
 * The result is an indented markdown-like string pushed to the host via
 * ui/update-model-context (MCP Apps) or setWidgetState (ChatGPT Apps SDK).
 */

const server = new MCPServer({
  name: "model-context-example",
  version: "1.0.0",
  description:
    "Demonstrates ModelContext and modelContext APIs for keeping the AI aware of widget UI state",
});

// Mock product catalog
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
    widget: {
      name: "context-demo",
      invoking: "Loading product browser...",
      invoked: "Product browser ready",
    },
  },
  async ({ category }) => {
    return widget({
      props: {
        products,
        initialCategory: category ?? null,
      },
      message: `Product browser opened${category ? ` on the ${category} tab` : ""}. The widget is now tracking what the user is viewing.`,
    });
  }
);

await server.listen();

console.log(`
Model Context Example Server Started!

Try calling: browse-products

Then interact with the widget tabs and product cards.
The AI will be automatically informed of what you're viewing via ModelContext.

- Switch tabs → model sees which category is active
- Hover a product → model sees the hovered item  
- Click a product → model sees the selected item (via modelContext.set)
`);

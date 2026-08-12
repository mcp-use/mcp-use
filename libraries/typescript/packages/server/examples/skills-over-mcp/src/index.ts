import { MCPServer } from "mcp-use";
import { z } from "zod";

// The adjacent skills/ directory is discovered automatically by mcp-use.
const server = new MCPServer({
  name: "skills-over-mcp-example",
  version: "1.0.0",
  description:
    "A shop server that publishes refund and purchasing instructions as MCP skills.",
});

server.tool(
  {
    name: "refund-order",
    description: "Refund an eligible order.",
    inputSchema: z.object({ orderId: z.string() }),
  },
  async ({ orderId }) => ({
    content: [{ type: "text", text: `Refunded order ${orderId}.` }],
  })
);

server.tool(
  {
    name: "create-purchase-order",
    description: "Create an approved purchase order.",
    inputSchema: z.object({
      sku: z.string(),
      quantity: z.number().int().positive(),
    }),
  },
  async ({ sku, quantity }) => ({
    content: [
      {
        type: "text",
        text: `Created a purchase order for ${quantity} × ${sku}.`,
      },
    ],
  })
);

server.tool(
  {
    name: "get-order-status",
    description: "Get the current status of an order.",
    inputSchema: z.object({ orderId: z.string() }),
  },
  async ({ orderId }) => ({
    content: [{ type: "text", text: `Order ${orderId} is processing.` }],
  })
);

// Export the server; `mcp-use dev`, `build`, and `start` load skills and own
// the HTTP listener.
export default server;

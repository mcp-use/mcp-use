import { createMCPServer } from "mcp-use/server";
import { z } from "zod";
import {
  products,
  getProductById,
  searchProducts,
  getInventoryStatus,
} from "./src/data/products";
import { getCart } from "./src/data/cart";

const server = createMCPServer("lovely-fruit-shop", {
  version: "1.0.0",
  description:
    "A delightful fruit shop showcasing ChatGPT app patterns: Know (data access), Do (actions), and Show (UI widgets)",
});

/**
 * AUTOMATIC UI WIDGET REGISTRATION
 * All React components in the `resources/` folder are automatically registered as MCP tools and resources.
 * Just export widgetMetadata with description and Zod schema, and mcp-use handles the rest!
 *
 * Widgets automatically registered:
 * - product-search-result: Browse and filter fruits with beautiful UI
 * - cart-view: View shopping cart with items and totals
 * - order-confirmation: Show order details after checkout
 * - product-details: Detailed view of a single fruit
 *
 * See docs: https://docs.mcp-use.com/typescript/server/ui-widgets
 */

/**
 * CONVERSATION FLOW DESIGN
 *
 * This template demonstrates handling different user intents:
 *
 * Vague Intent: "I want to buy some fruit"
 * → Call: search-products (no filters)
 * → Show: product-search-result with all fruits
 * → Offer: "Would you like to filter by color or price?"
 *
 * Specific Intent: "Show me red fruits under $5"
 * → Call: search-products({color: "red", maxPrice: 5})
 * → Show: product-search-result with filtered results
 * → No additional questions needed
 *
 * Action Intent: "Add 3 mangos to my cart"
 * → Call: add-to-cart({productId: "mango", quantity: 3})
 * → Show: cart-view widget
 * → Message: "Added 3 mangos to your cart!"
 *
 * Checkout Intent: "I want to checkout"
 * → Call: get-user-cart to show current cart
 * → Call: place-order to process
 * → Show: order-confirmation widget
 */

/**
 * ====================
 * KNOW TOOLS
 * ====================
 * These tools give ChatGPT access to data it doesn't have:
 * - Product inventory and details
 * - User's shopping cart state
 * - Search and filter capabilities
 */

// API endpoint for fruits data (used by widgets)
server.get("/api/fruits", (c) => {
  return c.json(
    products.map((p) => ({
      fruit: p.id,
      color: p.colorClass,
      name: p.name,
      price: p.price,
      inStock: p.inStock,
      stockCount: p.stockCount,
    }))
  );
});

// Search Products - Find fruits by filters
server.tool(
  {
    name: "search-products",
    description:
      "Search and filter fruits in the shop. Use this to help users discover products based on their preferences like color, price range, or specific keywords. Returns a list of matching products that can be displayed with the product-search-result widget. Great for both vague requests ('show me some fruits') and specific ones ('red fruits under $5').",
    inputs: z.object({
      color: z
        .string()
        .optional()
        .describe(
          "Filter by fruit color (e.g., 'red', 'yellow', 'orange', 'green')"
        ),
      minPrice: z
        .number()
        .optional()
        .describe("Minimum price in dollars (e.g., 2.99)"),
      maxPrice: z
        .number()
        .optional()
        .describe("Maximum price in dollars (e.g., 5.99)"),
      inStockOnly: z
        .boolean()
        .optional()
        .describe("Only show products that are currently in stock"),
      query: z
        .string()
        .optional()
        .describe("Search by product name or description keywords"),
    }),
  },
  async (params) => {
    const results = searchProducts(params);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              count: results.length,
              products: results.map((p) => ({
                id: p.id,
                name: p.name,
                price: p.price,
                inStock: p.inStock,
                stockCount: p.stockCount,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Get Product Details - Detailed info about a specific fruit
server.tool(
  {
    name: "get-product-details",
    description:
      "Get comprehensive details about a specific fruit including price, description, nutritional information, and stock status. Use this when a user asks about a specific product or wants to learn more before purchasing. The detailed information can be displayed with the product-details widget for a rich visual experience.",
    inputs: z.object({
      productId: z
        .string()
        .describe(
          "The unique identifier of the fruit (e.g., 'mango', 'apple', 'strawberry')"
        ),
    }),
  },
  async ({ productId }) => {
    const product = getProductById(productId);

    if (!product) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Product not found",
              productId,
            }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(product, null, 2),
        },
      ],
    };
  }
);

// Get Product Inventory - Check stock levels
server.tool(
  {
    name: "get-product-inventory",
    description:
      "Check real-time inventory and stock levels for specific fruits. Use this to answer questions about product availability ('Is mango in stock?') or to verify stock before adding items to cart. Returns current stock count and availability status.",
    inputs: z.object({
      productId: z
        .string()
        .describe(
          "The unique identifier of the fruit to check (e.g., 'mango', 'apple')"
        ),
    }),
  },
  async ({ productId }) => {
    const inventory = getInventoryStatus(productId);

    if (!inventory) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Product not found",
              productId,
            }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(inventory, null, 2),
        },
      ],
    };
  }
);

// Get User Cart - Retrieve current shopping cart
server.tool(
  {
    name: "get-user-cart",
    description:
      "Retrieve the user's current shopping cart with all items, quantities, and total price. Use this to show what's in the cart, answer questions about cart contents, or before proceeding to checkout. The cart can be beautifully displayed using the cart-view widget.",
    inputs: z.object({
      sessionId: z
        .string()
        .optional()
        .default("demo-session")
        .describe("Optional session identifier for the user's cart"),
    }),
  },
  async ({ sessionId }) => {
    const cart = getCart(sessionId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              itemCount: cart.itemCount,
              subtotal: cart.subtotal,
              items: cart.items.map((item) => ({
                productId: item.product.id,
                productName: item.product.name,
                quantity: item.quantity,
                price: item.product.price,
                lineTotal: item.product.price * item.quantity,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

/**
 * ====================
 * DO TOOLS
 * ====================
 * These tools let ChatGPT take actions on behalf of the user:
 * - Add/update/remove items in shopping cart
 * - Place orders
 * - Manage cart state
 */

// Add to Cart - Add a fruit to the shopping cart
server.tool(
  {
    name: "add-to-cart",
    description:
      "Add a fruit to the user's shopping cart. Use this when the user wants to purchase a product or add items to their cart. Specify the product ID and quantity. Returns the updated cart summary which can be displayed using the cart-view widget. After adding, consider showing a confirmation message.",
    inputs: z.object({
      productId: z
        .string()
        .describe(
          "The unique identifier of the fruit to add (e.g., 'mango', 'apple')"
        ),
      quantity: z
        .number()
        .min(1)
        .default(1)
        .describe("Number of items to add (default: 1)"),
      sessionId: z
        .string()
        .optional()
        .default("demo-session")
        .describe("Optional session identifier"),
    }),
  },
  async ({ productId, quantity, sessionId }) => {
    const { addToCart } = await import("./src/data/cart");
    const cart = addToCart(productId, quantity, sessionId);

    if (!cart) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Product not found",
              productId,
            }),
          },
        ],
      };
    }

    const product = getProductById(productId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              message: `Added ${quantity}x ${product?.name} to cart`,
              cart: {
                itemCount: cart.itemCount,
                subtotal: cart.subtotal,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Update Cart Item - Change quantity of an item in cart
server.tool(
  {
    name: "update-cart-item",
    description:
      "Update the quantity of a specific fruit in the shopping cart. Use this when the user wants to change how many of an item they want to purchase. Set quantity to 0 to remove the item. Returns the updated cart state.",
    inputs: z.object({
      productId: z
        .string()
        .describe("The unique identifier of the fruit to update"),
      quantity: z
        .number()
        .min(0)
        .describe("New quantity (set to 0 to remove item)"),
      sessionId: z
        .string()
        .optional()
        .default("demo-session")
        .describe("Optional session identifier"),
    }),
  },
  async ({ productId, quantity, sessionId }) => {
    const { updateCartItem } = await import("./src/data/cart");
    const cart = updateCartItem(productId, quantity, sessionId);

    if (!cart) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Item not found in cart",
              productId,
            }),
          },
        ],
      };
    }

    const product = getProductById(productId);
    const action = quantity === 0 ? "Removed" : "Updated";

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              message: `${action} ${product?.name} in cart`,
              cart: {
                itemCount: cart.itemCount,
                subtotal: cart.subtotal,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Remove from Cart - Remove a fruit from the cart
server.tool(
  {
    name: "remove-from-cart",
    description:
      "Remove a specific fruit from the shopping cart completely. Use this when the user wants to delete an item from their cart. Returns the updated cart state.",
    inputs: z.object({
      productId: z
        .string()
        .describe("The unique identifier of the fruit to remove"),
      sessionId: z
        .string()
        .optional()
        .default("demo-session")
        .describe("Optional session identifier"),
    }),
  },
  async ({ productId, sessionId }) => {
    const { removeFromCart } = await import("./src/data/cart");
    const cart = removeFromCart(productId, sessionId);

    const product = getProductById(productId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              message: `Removed ${product?.name} from cart`,
              cart: {
                itemCount: cart.itemCount,
                subtotal: cart.subtotal,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Clear Cart - Empty the entire cart
server.tool(
  {
    name: "clear-cart",
    description:
      "Remove all items from the shopping cart. Use this when the user wants to start over or empty their cart completely. Returns an empty cart state.",
    inputs: z.object({
      sessionId: z
        .string()
        .optional()
        .default("demo-session")
        .describe("Optional session identifier"),
    }),
  },
  async ({ sessionId }) => {
    const { clearCart } = await import("./src/data/cart");
    const cart = clearCart(sessionId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              message: "Cart has been cleared",
              cart: {
                itemCount: cart.itemCount,
                subtotal: cart.subtotal,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Place Order - Complete the purchase
server.tool(
  {
    name: "place-order",
    description:
      "Process the user's cart and place an order. Use this when the user is ready to checkout and complete their purchase. Returns order confirmation details including order ID, items, total, and estimated delivery date. The order details can be displayed with the order-confirmation widget. Note: This will clear the cart after placing the order.",
    inputs: z.object({
      sessionId: z
        .string()
        .optional()
        .default("demo-session")
        .describe("Optional session identifier"),
    }),
  },
  async ({ sessionId }) => {
    const { placeOrder } = await import("./src/data/orders");
    const result = placeOrder(sessionId);

    if (!result) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Cannot place order with an empty cart",
            }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              message: result.message,
              order: {
                orderId: result.order.orderId,
                total: result.order.total,
                itemCount: result.order.items.length,
                status: result.order.status,
                estimatedDelivery: result.order.estimatedDelivery,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

/**
 * ====================
 * BRAND INFO
 * ====================
 */

// Get Brand Info - Information about the Lovely Fruit Shop
server.tool(
  {
    name: "get-brand-info",
    description:
      "Get information about the Lovely Little Fruit Shop - our story, mission, and what makes us special. Use this when users ask about the store, want to know more about us, or are browsing for the first time. Great for building trust and introducing the brand.",
  },
  async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              name: "Lovely Little Fruit Shop",
              tagline: "Fresh, delightful fruits delivered to your door 🍎",
              description:
                "We're a family-owned fruit shop bringing the freshest, most delicious fruits right to your doorstep. Every fruit is hand-picked for quality and ripeness.",
              mission:
                "To make healthy, delicious fruits accessible to everyone while supporting sustainable farming practices.",
              values: [
                "Quality First",
                "Sustainable Sourcing",
                "Customer Delight",
                "Farm-to-Table Freshness",
              ],
              features: [
                "Hand-picked fresh fruits daily",
                "3-5 day delivery guarantee",
                "Wide variety of seasonal fruits",
                "Detailed nutritional information",
                "Easy online ordering",
              ],
              whyChooseUs: [
                "🌱 Sustainably sourced from local farms",
                "🚚 Fast and reliable delivery",
                "💯 Quality guaranteed or money back",
                "📊 Complete nutritional information",
                "🎨 Beautiful and fresh presentation",
              ],
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.listen().then(() => {
  console.log(`Server running`);
});

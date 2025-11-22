import { createMCPServer } from "mcp-use/server";

const server = createMCPServer("test-app", {
  version: "1.0.0",
  description: "Test MCP server with automatic UI widget registration",
});

/**
 * AUTOMATIC UI WIDGET REGISTRATION
 * All React components in the `resources/` folder are automatically registered as MCP tools and resources.
 * Just export widgetMetadata with description and Zod schema, and mcp-use handles the rest!
 *
 * It will automatically add to your MCP server:
 * - server.tool('display-weather')
 * - server.resource('ui://widget/display-weather')
 *
 * See docs: https://docs.mcp-use.com/typescript/server/ui-widgets
 */

/**
 * Add here your standard MCP tools, resources and prompts
 */

// Brand Info Tool - Returns brand information
server.tool({
  name: "get-brand-info",
  description: "Get information about the brand, including company details, mission, and values",
  cb: async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              name: "EcoShop",
              tagline: "Sustainable Products for a Better Tomorrow",
              description:
                "EcoShop is a leading e-commerce platform dedicated to providing high-quality, sustainable products that help customers live more environmentally conscious lives.",
              founded: "2015",
              headquarters: "San Francisco, CA",
              mission:
                "To make sustainable living accessible and affordable for everyone",
              values: [
                "Sustainability",
                "Quality",
                "Transparency",
                "Customer Focus",
                "Innovation",
              ],
              contact: {
                email: "info@ecoshop.com",
                phone: "+1 (555) 123-4567",
                website: "https://www.ecoshop.com",
              },
              socialMedia: {
                twitter: "@ecoshop",
                instagram: "@ecoshop_official",
                facebook: "EcoShopOfficial",
              },
            },
            null,
            2
          ),
        },
      ],
    };
  },
});

// Helper tools for widget interactions

server.tool({
  name: "add-to-cart",
  description: "Add a product to the shopping cart",
  inputs: [
    { name: "productId", type: "string", required: true },
    { name: "productName", type: "string", required: true },
    { name: "price", type: "number", required: true },
  ],
  cb: async ({ productId, productName, price }) => {
    return {
      content: [
        {
          type: "text",
          text: `Added "${productName}" ($${price.toFixed(2)}) to cart successfully.`,
        },
      ],
    };
  },
});

server.tool({
  name: "get-product-info",
  description: "Get detailed information about a product",
  inputs: [
    { name: "productId", type: "string", required: true },
    { name: "productName", type: "string", required: true },
  ],
  cb: async ({ productId, productName }) => {
    return {
      content: [
        {
          type: "text",
          text: `Product details for "${productName}" (ID: ${productId}): This is a high-quality product with excellent reviews.`,
        },
      ],
    };
  },
});

server.tool({
  name: "search-products",
  description: "Search for products by query",
  inputs: [{ name: "query", type: "string", required: true }],
  cb: async ({ query }) => {
    return {
      content: [
        {
          type: "text",
          text: `Search results for "${query}": Found 15 products matching your search criteria.`,
        },
      ],
    };
  },
});

server.tool({
  name: "get-product-details",
  description: "Get detailed information about a specific product",
  inputs: [{ name: "productId", type: "string", required: true }],
  cb: async ({ productId }) => {
    return {
      content: [
        {
          type: "text",
          text: `Product details for product ID: ${productId}`,
        },
      ],
    };
  },
});

server.tool({
  name: "get-store-details",
  description: "Get detailed information about a store location",
  inputs: [{ name: "storeId", type: "string", required: true }],
  cb: async ({ storeId }) => {
    return {
      content: [
        {
          type: "text",
          text: `Store details for store ID: ${storeId}. This location offers full product selection and customer service.`,
        },
      ],
    };
  },
});

server.tool({
  name: "get-directions",
  description: "Get directions to a destination",
  inputs: [
    { name: "destination", type: "string", required: true },
    { name: "latitude", type: "number", required: true },
    { name: "longitude", type: "number", required: true },
  ],
  cb: async ({ destination }) => {
    return {
      content: [
        {
          type: "text",
          text: `Directions to ${destination} have been generated.`,
        },
      ],
    };
  },
});

server.tool({
  name: "track-order",
  description: "Track the status of an order",
  inputs: [{ name: "orderId", type: "string", required: true }],
  cb: async ({ orderId }) => {
    return {
      content: [
        {
          type: "text",
          text: `Order ${orderId} is currently being processed and will be shipped soon.`,
        },
      ],
    };
  },
});

server.tool({
  name: "get-receipt",
  description: "Get receipt for an order",
  inputs: [{ name: "orderId", type: "string", required: true }],
  cb: async ({ orderId }) => {
    return {
      content: [
        {
          type: "text",
          text: `Receipt for order ${orderId} has been generated and sent to your email.`,
        },
      ],
    };
  },
});

server.listen().then(() => {
  console.log(`Server running`);
});

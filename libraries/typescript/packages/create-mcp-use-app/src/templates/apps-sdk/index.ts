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
 * - server.tool('get-brand-info')
 * - server.resource('ui://widget/get-brand-info')
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

server.listen().then(() => {
  console.log(`Server running`);
});

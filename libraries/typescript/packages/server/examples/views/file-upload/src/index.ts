/**
 * File Upload — ChatGPT-specific file upload example.
 *
 * Follows the CLI entry contract: default-export the MCPServer instance;
 * `mcp-use dev` / `build` / `start` own the socket and view priming.
 */
import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "file-upload-example",
  version: "1.0.0",
  title: "File Upload Example",
  legacy: "stateless",
  logging: { level: "debug" },
  description: "Upload and download files from a ChatGPT MCP Apps view.",
  basePath: "/mcp",
});

const uploadViewSchema = z.object({
  message: z.string(),
});

export const openFileUpload = server.tool(
  {
    name: "open-file-upload",
    title: "Open file upload",
    description: "Open a view where the user can upload a file in ChatGPT.",
    inputSchema: z.object({}),
    outputSchema: uploadViewSchema,
    view: {
      name: "file-upload",
      description: "ChatGPT file upload controls",
      prefersBorder: true,
    },
  },
  async () => ({
    content: [
      {
        type: "text",
        text: "The file upload view is ready.",
      },
    ],
    structuredContent: {
      message: "Choose a file to upload from the view.",
    },
  })
);

export default server;

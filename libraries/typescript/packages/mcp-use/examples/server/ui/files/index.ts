import { MCPServer, widget } from "mcp-use/server";
import { z } from "zod";

/**
 * FILE HANDLING EXAMPLE
 *
 * Demonstrates the useFiles() hook for file upload and download in widgets.
 *
 * IMPORTANT: File operations are only supported in the ChatGPT Apps SDK
 * environment. The MCP Apps spec (SEP-1865) has deferred file handling:
 * https://github.com/modelcontextprotocol/ext-apps/issues/201
 *
 * The widget uses the `isSupported` flag from useFiles() to gracefully
 * handle environments where files are not available (MCP Apps clients
 * like Claude, Goose, etc.) rather than throwing an error.
 */

const server = new MCPServer({
  name: "files-example",
  version: "1.0.0",
  description:
    "Demonstrates useFiles() hook for file upload and download with isSupported detection",
});

server.tool(
  {
    name: "open-file-manager",
    description:
      "Open an interactive file manager widget. Supports uploading files and retrieving download URLs. " +
      "File operations are only available in ChatGPT — the widget will show a notice in other clients.",
    schema: z.object({}),
    widget: {
      name: "file-manager",
      invoking: "Opening file manager...",
      invoked: "File manager ready",
    },
  },
  async () => {
    return widget({
      props: {},
      message:
        "File manager opened. You can upload files and retrieve download links. " +
        "Note: file operations are only available in ChatGPT.",
    });
  }
);

await server.listen();

console.log(`
File Handling Example Server Started!

Try calling: open-file-manager

The widget demonstrates:
- isSupported detection (shows notice in MCP Apps clients)
- File upload via useFiles().upload()
- Download URL retrieval via useFiles().getDownloadUrl()
- Upload progress state management
- Error handling

Note: File operations only work in ChatGPT (Apps SDK).
In other clients (Claude, Goose, etc.) the widget shows an informational notice.
`);

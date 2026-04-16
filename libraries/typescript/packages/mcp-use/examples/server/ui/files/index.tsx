/** @jsxImportSource mcp-use/jsx */

import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";
import FileManager from "./components/FileManager";

/**
 * FILE HANDLING EXAMPLE — inline JSX + components/FileManager.tsx
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
  },
  async () => {
    return (
      <FileManager
        _output={text(
          "File manager opened. You can upload files and retrieve download links. " +
            "Note: file operations are only available in ChatGPT."
        )}
        _invoking="Opening file manager..."
        _invoked="File manager ready"
        _prefersBorder={true}
        _meta={{ autoResize: true }}
      />
    );
  }
);

await server.listen();

console.log(`Files example — try: open-file-manager`);

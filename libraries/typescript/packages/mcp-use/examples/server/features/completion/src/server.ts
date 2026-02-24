import { MCPServer, completable } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "completion-example-server",
  version: "1.0.0",
  description:
    "An MCP server example demonstrating completion capabilities for prompt and resource template arguments",
});

/**
 * Prompt with static list completion - languages for code review
 */
server.prompt(
  {
    name: "code-review",
    schema: z.object({
      language: completable(z.string(), [
        "python",
        "typescript",
        "javascript",
        "java",
        "go",
        "rust",
      ]),
      severity: z.string(),
    }),
  },
  async ({ language, severity }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Review code in ${language} with ${severity} severity`,
        },
      },
    ],
  })
);

/**
 * Prompt with dynamic callback completion - file extensions
 */
server.prompt(
  {
    name: "file-search",
    schema: z.object({
      extension: completable(z.string(), async (value: string) => {
        const extensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".md"];
        return extensions.filter((ext) => ext.startsWith(value));
      }),
      directory: z.string(),
    }),
  },
  async ({ extension, directory }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Find files with extension ${extension} in ${directory}`,
        },
      },
    ],
  })
);

/**
 * Resource template with completion for path variable
 */
server.resourceTemplate({
  uriTemplate: "file:///{path}",
  name: "File",
  description: "Read a file from common directories",
  schema: z.object({
    path: completable(z.string(), [
      "/home/user/documents",
      "/home/user/downloads",
      "/home/user/projects",
    ]),
  }),
  readCallback: async ({ path }) => ({
    contents: [
      {
        uri: `file:///${path}`,
        text: `Content of ${path}`,
      },
    ],
  }),
});

await server.listen();

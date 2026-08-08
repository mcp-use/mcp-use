/**
 * Story Writer — streaming tool-input MCP Apps views example.
 *
 * Follows the CLI entry contract: default-export the MCPServer instance;
 * `mcp-use dev` / `build` / `start` own the socket and view priming.
 */
import { MCPServer } from "mcp-use";
import { z } from "zod";

const BASE_PATH = "/mcp";

const server = new MCPServer({
  name: "story-writer",
  version: "1.0.0",
  title: "Story Writer",
  legacy: "stateless",
  logging: { level: "debug" },
  description: "Stream a short story into an MCP Apps view as it is written.",
  basePath: BASE_PATH,
});

const storyOutputSchema = z.object({
  title: z.string(),
  wordCount: z.number(),
});

export const writeStory = server.tool(
  {
    name: "write-story",
    title: "Write a story",
    description:
      "Write a short story and display it in a live view. The story streams into the view as it is written — generate the story text directly into the `story` argument.",
    inputSchema: z.object({
      title: z.string().describe("Story title"),
      story: z.string().describe("The full story text, a few paragraphs"),
    }),
    outputSchema: storyOutputSchema,
    view: {
      name: "story-writer",
      description: "Live story writing view",
      prefersBorder: true,
    },
  },
  async ({ title, story }) => {
    const trimmed = story.trim();
    const wordCount = trimmed === "" ? 0 : trimmed.split(/\s+/).length;

    return {
      content: [
        {
          type: "text",
          text: `Finished "${title}" (${wordCount} words)`,
        },
      ],
      structuredContent: { title, wordCount },
    };
  }
);

export default server;

import { MCPServer } from "mcp-use";
import { z } from "zod";

import { createDemoFiles } from "./demo-files.js";
import { notes, searchNotes } from "./notes.js";

const files = createDemoFiles();
const noteIdSchema = z.enum(["welcome", "packing-list", "meeting-notes"]);
const server = new MCPServer({
  name: "markdown-notes",
  title: "Markdown Notes",
  version: "1.0.0",
  description:
    "Mention sample notes and edit a host-opened Markdown demo file.",
  legacy: "stateless",
  basePath: "/mcp",
});

const catalog = notes.map(({ id, title, description, content }) => ({
  id,
  title,
  description,
  content,
}));

/** Open the notes catalog from the host's global launcher or a tool call. */
export const openNotes = server.tool(
  {
    name: "open-notes",
    title: "Open notes",
    description: "Browse three sample notes and create a Markdown demo file.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      notes: z.array(
        z.object({
          id: noteIdSchema,
          title: z.string(),
          description: z.string(),
          content: z.string(),
        })
      ),
    }),
    annotations: { readOnlyHint: true },
    view: {
      name: "notes",
      description: "A small Markdown notes catalog",
      entrypoints: [{ type: "global" }],
      prefersBorder: true,
    },
  },
  async () => ({
    content: [{ type: "text", text: "Opened the sample notes catalog." }],
    structuredContent: { notes: catalog },
  })
);

/** Create a new bounded demo copy and return its absolute server-host path. */
export const createDemoFile = server.tool(
  {
    name: "create-demo-file",
    title: "Create demo file",
    description:
      "Create a new Markdown copy of a bundled note on the server execution host.",
    inputSchema: z.object({
      noteId: noteIdSchema,
    }),
    outputSchema: z.object({ path: z.string(), name: z.string() }),
    annotations: { destructiveHint: false },
  },
  async ({ noteId }) => ({
    content: [
      {
        type: "text",
        text: "Created a new demo file on the server execution host.",
      },
    ],
    structuredContent: await files.create(noteId),
  })
);

server.mentions({
  name: "search-notes",
  title: "Search notes",
  search: async ({ query }) => ({ items: searchNotes(query) }),
});

for (const note of notes) {
  server.resource(
    {
      name: note.id,
      uri: `notes://catalog/${note.id}`,
      title: note.title,
      description: note.description,
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "text/markdown", text: note.content },
      ],
    })
  );
}

export default server;

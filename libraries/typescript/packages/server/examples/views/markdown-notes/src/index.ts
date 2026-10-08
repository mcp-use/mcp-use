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

const fileInput = z.object({
  file: z.object({ name: z.string(), resourceUri: z.string() }),
});

/** Bind an opaque host-opened Markdown or text file to the editor View. */
export const openNoteFile = server.tool(
  {
    name: "open-note-file",
    title: "Edit demo note",
    description: "Read and edit a Markdown Notes demo copy opened by the host.",
    inputSchema: fileInput,
    outputSchema: fileInput,
    annotations: { readOnlyHint: true },
    view: {
      name: "note-file",
      entrypoints: [{ type: "file", extensions: [".md", ".txt"] }],
      description: "A plain text editor for a bounded demo file",
      prefersBorder: true,
    },
  },
  async ({ file }) => ({ content: [], structuredContent: { file } })
);

/** Check the host-injected path on the server without sending it to the View. */
export const checkDemoFile = server.tool(
  {
    name: "check-demo-file",
    title: "Check demo file",
    description:
      "Allow only regular Markdown or text files inside this app's demo directory.",
    inputSchema: z.object({}),
    outputSchema: z.object({ allowed: z.boolean(), message: z.string() }),
    visibility: "app",
    annotations: { readOnlyHint: true },
  },
  async (_args, ctx) => {
    const resource = ctx.client.resource();
    const allowed =
      resource !== undefined &&
      /\.(md|txt)$/i.test(resource.path) &&
      (await files.contains(resource.path));
    return {
      content: [],
      structuredContent: {
        allowed,
        message: allowed
          ? "Demo file verified."
          : "Open a demo copy created by Markdown Notes. Files outside the demo directory cannot be edited here.",
      },
    };
  }
);

/** App-visible composer search returning links resolved by this server's resources. */
export const searchMentions = server.mentions({
  name: "search-notes",
  title: "Search notes",
  description:
    "Search three bundled Markdown notes; an empty query lists all notes.",
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

import { MCPServer, object, text } from "mcp-use/server";
import { z } from "zod";

interface Note {
  title: string;
  content: string;
}

const notes = new Map<string, Note>();

const server = new MCPServer({
  name: "stateful-notes-server",
  version: "1.0.0",
  description: "Golden solution for the stateful notes server eval task",
});

server.tool(
  {
    name: "save_note",
    description: "Create a note, or replace it if the id already exists",
    schema: z.object({
      id: z.string().describe("Unique note id"),
      title: z.string().describe("Note title"),
      content: z.string().describe("Note body"),
    }),
  },
  async ({ id, title, content }) => {
    notes.set(id, { title, content });
    return text(`Saved note "${id}"`);
  }
);

server.tool(
  {
    name: "get_note",
    description: "Fetch a note's title and content by id",
    schema: z.object({ id: z.string().describe("Note id to fetch") }),
  },
  async ({ id }) => {
    const note = notes.get(id);
    if (!note) return text(`Note "${id}" not found`);
    return text(`${note.title}\n${note.content}`);
  }
);

server.tool(
  {
    name: "list_notes",
    description: "List the titles of all stored notes with the total count",
    schema: z.object({}),
  },
  async () =>
    object({
      count: notes.size,
      titles: [...notes.values()].map((note) => note.title),
    })
);

server.tool(
  {
    name: "delete_note",
    description: "Delete a note by id",
    schema: z.object({ id: z.string().describe("Note id to delete") }),
  },
  async ({ id }) => {
    if (!notes.delete(id)) return text(`Note "${id}" not found`);
    return text(`Deleted note "${id}"`);
  }
);

// listen() resolves the port from PORT env (default 3000)
await server.listen();

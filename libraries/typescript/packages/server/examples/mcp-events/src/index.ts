import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "notes",
  version: "1.0.0",
  description: "A notes server that emits MCP Events when notes are created.",
});

interface Note {
  noteId: string;
  folder: string;
  title: string;
}

const notes: Note[] = [];
let nextId = 1;
const runId = Date.now().toString(36);

/**
 * `folder` appears in both schemas, so a subscription to `{ folder: "inbox" }`
 * receives only inbox notes; no custom filter is needed.
 */
export const noteCreated = server.event({
  name: "note.created",
  description:
    "A note was created in a folder you follow. Summarize it in one sentence.",
  inputSchema: z.object({
    folder: z.string().optional().describe("Only notes in this folder"),
  }),
  payloadSchema: z.object({
    folder: z.string(),
    noteId: z.string(),
    title: z.string(),
  }),
});

export const createNote = server.tool(
  {
    name: "create_note",
    description: "Create a note in a folder. Emits note.created.",
    inputSchema: z.object({ folder: z.string(), title: z.string() }),
  },
  async ({ folder, title }) => {
    const noteId = `note_${runId}_${nextId++}`;
    notes.push({ noteId, folder, title });
    // The note id is the eventId: stable across retries. ChatGPT-dialect
    // deliveries also use it as webhook-id; official-dialect ones get msg_... ids.
    // The note is already saved, so a failed emit (e.g. store outage) is
    // logged instead of failing the tool call.
    await noteCreated
      .emit({ folder, noteId, title }, { eventId: noteId })
      .catch((err) => console.error(`note.created emit failed: ${err}`));
    return { content: [{ type: "text", text: `Created ${noteId}` }] };
  }
);

/** Events carry ids; this tool returns the content. */
export const listNotes = server.tool(
  {
    name: "list_notes",
    description: "List notes, optionally in one folder.",
    inputSchema: z.object({ folder: z.string().optional() }),
  },
  async ({ folder }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          notes.filter((n) => folder === undefined || n.folder === folder)
        ),
      },
    ],
  })
);

export default server;

// A real MCPServer with one event, for `mcp-use client <server> events`.
// Prints `READY <port>` once listening.
import { z } from "zod";

import { MCPServer } from "../../../../server/dist/index-node.js";

const server = new MCPServer({ name: "events-fixture", version: "1.0.0" });

const noteCreated = server.event({
  name: "note.created",
  description: "A note was created.",
  inputSchema: z.object({ folder: z.string().optional() }),
  payloadSchema: z.object({
    folder: z.string(),
    noteId: z.string(),
    title: z.string(),
  }),
});

server.tool(
  {
    name: "create_note",
    description: "Create a note and emit note.created.",
    inputSchema: z.object({
      folder: z.string(),
      noteId: z.string(),
      title: z.string(),
    }),
  },
  async ({ folder, noteId, title }) => {
    await noteCreated.emit({ folder, noteId, title }, { eventId: noteId });
    return { content: [{ type: "text", text: `Created ${noteId}` }] };
  }
);

const port = Number(process.env.PORT ?? 0);
await server.listen(port);
process.stdout.write(`READY ${port}\n`);

/**
 * MCP Events test server.
 *
 * A notes server that declares one event (`note.created`, webhook and poll
 * delivery) and a `create_note` tool that emits it, modeled on
 * packages/server/examples/mcp-events.
 *
 * `allowInsecureCallbacks: true` behaves like `mcp-use dev` (which sets
 * MCP_USE_EVENTS_INSECURE=1): it accepts the Inspector's `http://localhost`
 * webhook inbox and signed-out webhook subscriptions. With `false` it behaves
 * like a deployed server: webhook subscriptions need a signed-in principal,
 * so the Inspector shows its sign-in notice and offers Poll instead.
 */

import { serve, type ServerType } from "@hono/node-server";
import { MCPServer } from "mcp-use";
import { z } from "zod";

export const EVENTS_SERVER_NAME = "EventsTestServer";

export function createEventsServer(options: {
  port: number;
  allowInsecureCallbacks: boolean;
}) {
  const server = new MCPServer({
    name: EVENTS_SERVER_NAME,
    version: "1.0.0",
    description: "MCP server with MCP Events for Inspector e2e tests",
    inspector: { enabled: false },
    events: { allowInsecureCallbacks: options.allowInsecureCallbacks },
  });

  let nextId = 1;
  const runId = Date.now().toString(36);

  const noteCreated = server.event({
    name: "note.created",
    description: "A note was created in a folder you follow.",
    inputSchema: z.object({
      folder: z.string().optional().describe("Only notes in this folder"),
    }),
    payloadSchema: z.object({
      folder: z.string(),
      noteId: z.string(),
      title: z.string(),
    }),
  });

  server.tool(
    {
      name: "create_note",
      description: "Create a note in a folder. Emits note.created.",
      inputSchema: z.object({ folder: z.string(), title: z.string() }),
    },
    async ({ folder, title }) => {
      const noteId = `note_${runId}_${nextId++}`;
      await noteCreated.emit({ folder, noteId, title }, { eventId: noteId });
      return { content: [{ type: "text", text: `Created ${noteId}` }] };
    }
  );

  let httpServer: ServerType | undefined;

  return {
    url: `http://localhost:${options.port}/mcp`,
    /** Emit directly, as if a tool call created a note. */
    emit: (data: { folder: string; noteId: string; title: string }) =>
      noteCreated.emit(data, { eventId: data.noteId }),
    async listen() {
      await new Promise<void>((resolve, reject) => {
        httpServer = serve(
          {
            fetch: (req) => server.fetch(req),
            port: options.port,
            hostname: "127.0.0.1",
          },
          () => resolve()
        );
        httpServer.on("error", reject);
      });
    },
    async close() {
      await server.close();
      if (httpServer) {
        await new Promise<void>((resolve) =>
          httpServer!.close(() => resolve())
        );
        httpServer = undefined;
      }
    },
  };
}

import { MCPServer } from "mcp-use";
import type { DialectId, EventsConfig } from "mcp-use";
import { z } from "zod";

/**
 * Example-local compatibility overrides (plan §16.2). mcp-use never reads
 * these variables; this file maps each one 1:1 onto public `events` config so
 * the live-validation checklist can drive one server through every profile.
 */
function eventsConfigFromEnv(env: NodeJS.ProcessEnv): EventsConfig {
  const config: EventsConfig = {};
  const compatibility: NonNullable<EventsConfig["compatibility"]> = {};

  if (env.EXAMPLE_EVENTS_DIALECT) {
    compatibility.dialect = env.EXAMPLE_EVENTS_DIALECT as DialectId;
  }
  if (env.EXAMPLE_EVENTS_AXES) {
    compatibility.axes = JSON.parse(env.EXAMPLE_EVENTS_AXES) as NonNullable<
      typeof compatibility.axes
    >;
  }
  if (env.EXAMPLE_EVENTS_ADVERTISE) {
    // One row for the client under test, tried before the built-in table: it
    // matches every client and keeps the forced (or ChatGPT) preset, so only
    // where the capability is advertised changes ("top", "extension", "both").
    type KnownClientRow = NonNullable<
      NonNullable<EventsConfig["compatibility"]>["knownClients"]
    >[number];
    const row: KnownClientRow = {
      id: "example-override",
      match: {},
      preset: env.EXAMPLE_EVENTS_DIALECT ?? "openai@1",
      advertise: env.EXAMPLE_EVENTS_ADVERTISE as NonNullable<
        KnownClientRow["advertise"]
      >,
      source: "examples/mcp-events EXAMPLE_EVENTS_ADVERTISE (local override)",
    };
    compatibility.knownClients = [row];
  }
  if (Object.keys(compatibility).length > 0)
    config.compatibility = compatibility;

  if (env.EXAMPLE_EVENTS_TTL_MS) {
    config.ttl = { default: Number(env.EXAMPLE_EVENTS_TTL_MS) };
  }
  if (env.EXAMPLE_EVENTS_ANONYMOUS) {
    config.anonymous = env.EXAMPLE_EVENTS_ANONYMOUS as NonNullable<
      EventsConfig["anonymous"]
    >;
  }
  return config;
}

const server = new MCPServer({
  name: "notes",
  version: "1.0.0",
  description: "A notes server that emits MCP Events when notes are created.",
  events: eventsConfigFromEnv(process.env),
});

interface Note {
  noteId: string;
  folder: string;
  title: string;
}

const notes: Note[] = [];
let nextId = 1;
// The dev event store outlives the process and dedupes eventIds for 24 h, so
// ids carry a per-process prefix: a restart must not reuse note_1.
const runId = Date.now().toString(36);

/**
 * Replayable (the default: 1 h, 1,000 events), so it is offered over webhook,
 * push and poll, with cursors for SEP clients. `folder` appears in both
 * schemas, so a subscription to `{ folder: "inbox" }` receives only inbox
 * notes and an omitted `folder` receives everything; no `match` is needed.
 */
export const noteCreated = server.event({
  name: "note.created",
  description:
    "A note was created in a folder you follow. Summarize it in one sentence and ask whether to act on it.",
  inputSchema: z.object({
    folder: z.string().optional().describe("Only notes in this folder"),
  }),
  payloadSchema: z.object({
    folder: z.string(),
    noteId: z.string(),
    title: z.string(),
  }),
});

/**
 * A heartbeat with no history: `replay: false` means no cursor, no poll, and
 * at-most-once delivery across push reconnects. Off unless
 * EXAMPLE_EVENTS_TICK_MS is set, so the default server stays quiet.
 */
export const clockTick = server.event({
  name: "clock.tick",
  description:
    "A periodic clock tick for testing delivery. Do nothing unless the user asked to watch ticks.",
  payloadSchema: z.object({ at: z.string() }),
  replay: false,
});

export const createNote = server.tool(
  {
    name: "create_note",
    description: "Create a note in a folder. Emits note.created.",
    inputSchema: z.object({ folder: z.string(), title: z.string() }),
  },
  async ({ folder, title }, ctx) => {
    const noteId = `note_${runId}_${nextId++}`;
    notes.push({ noteId, folder, title });
    // Upstream-stable id: retries of the same note dedupe for 24 h. onError
    // "log" keeps the tool working if event storage is down.
    await noteCreated.emit(
      { folder, noteId, title },
      { eventId: noteId, ctx, onError: "log" }
    );
    return { content: [{ type: "text", text: `Created ${noteId}` }] };
  }
);

/** The read tool that payloads point at: events carry ids, tools carry content. */
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
          notes.filter((note) => folder === undefined || note.folder === folder)
        ),
      },
    ],
  })
);

const tickMs = Number(process.env.EXAMPLE_EVENTS_TICK_MS ?? 0);
if (tickMs > 0) {
  setInterval(() => {
    void clockTick.emit({ at: new Date().toISOString() }, { onError: "log" });
  }, tickMs).unref();
}

export default server;

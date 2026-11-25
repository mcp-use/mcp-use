# MCP Events

Use MCP Events when a server must tell subscribers that something happened
(a note was created, an issue opened, a build failed), including subscribers
that are offline or reached by webhook. For live list or resource
invalidation to connected clients, use notifications instead.

## Define and emit

```ts
import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({ name: "notes", version: "1.0.0" });

export const noteCreated = server.event({
  name: "note.created",
  description:
    "A note was created in a folder you follow. Summarize it in one sentence and ask whether to act on it.",
  inputSchema: z.object({ folder: z.string().optional().describe("Only notes in this folder") }),
  payloadSchema: z.object({ folder: z.string(), noteId: z.string(), title: z.string() }),
});

// inside a tool, a route or a queue consumer:
await noteCreated.emit({ folder, noteId, title }, { eventId: noteId, ctx, onError: "log" });
```

- Register events before start; `server.event()` throws `EventsConfigError` with a `code` on invalid definitions.
- `emit()` resolves after a durable append. Delivery happens in the background.

## Write the description

ChatGPT reacts from the `description` alone, and its default reaction is to
notify only. State the trigger and the action: "Summarize it and suggest
labels." Never rely on payload text to instruct the model.

## Schema conventions

- `inputSchema` holds subscription filters. A filter key with a same-named
  scalar in `payloadSchema` is matched automatically; an omitted optional
  argument matches everything.
- Use `match(args, data, { principal, subscriptionId, dialect, mode })` only
  when the payload has no same-named field. `match` has no request context.
- Use `authorize(args, ctx)` for permission checks; it gets the request
  context. Add `scopes` for OAuth scopes.
- Use upstream-stable `eventId` values; repeats within 24 h dedupe.
- Per-user events: `emit(data, { principal })`.

## Keep payloads small

Send ids, URLs and short summaries (bodies must stay under 256 KiB). Add a
read tool (`get_note`) for full content and name it in the description.
Payload data is untrusted.

## Replay and delivery modes

- Events are replayable by default (1 h, 1,000 events) and offered over
  webhook, push and poll, with cursors for SEP-3415 clients.
- `replay: false` for high-volume events with no history: no cursor, no poll.
- `delivery: { push: false }` turns a mode off for one event.
- ChatGPT uses webhooks (`openai` dialect). mcp-use selects the dialect itself.

## Avoid feedback loops

A reaction that calls a tool that emits the same event loops. Design tools so
reactions do not re-emit; the server caps deliveries per subscription at 60
per minute.

## The scope gotcha

ChatGPT requests scopes it sees on tools. If events need scopes no tool
declares, subscribe fails with `insufficient_scope`. Set
`events: { scopes: { attachToTools: true } }`.

## Develop with ChatGPT

```bash
mcp-use dev            # Inspector Events tab; dev principal dev|local; no config
mcp-use dev --tunnel   # ChatGPT can subscribe; no-OAuth servers allow anonymous openai webhooks
```

After a catalog change, press **Refresh tools** on the ChatGPT connector.

## Choose hosting

- **Manufact Cloud:** no configuration; the platform injects storage.
- **Own hosting:** set `MCP_USE_STORAGE_URL` (Redis, Upstash, Postgres) and
  `MCP_USE_SECRET`. Serverless hosts also need a cron that calls
  `{basePath}/_mcp-use/events/tick`; Workers export `server` (it has
  `scheduled`). Workers KV is not supported; use D1, a Durable Object or
  Upstash.

Docs: `/typescript/server/events`, `/typescript/server/events-chatgpt`,
`/typescript/server/events-deployment`, `/typescript/server/events-troubleshooting`.

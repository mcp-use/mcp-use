# MCP Events: notes server

`create_note` emits `note.created`, delivered by webhook to subscribers
(ChatGPT and the official MCP Events extension) and readable by polling
(official extension). Nothing to configure in dev: subscriptions and the poll
log are kept in `.mcp-use/state/events/` and survive restarts.

```sh
pnpm dev
```

Open the Inspector's **Events** tab, subscribe to `note.created` with
`{ "folder": "inbox" }` (the callback is the Inspector's webhook inbox), then
call `create_note` with `{ "folder": "inbox", "title": "Hello" }`. The signed
delivery appears in the inbox; its `eventId` is the note id (the
`webhook-id` header is a server-generated `msg_...` id, kept across retries).

## Poll consumer

With `pnpm dev` running, in another terminal:

```sh
pnpm poll inbox
```

`src/poll.ts` calls `events/poll` with `pollEvents` from `@mcp-use/client`,
starting from now. Create a note in `inbox` and it is printed on the next poll.
The CLI does the same: `mcp-use client notes events poll note.created folder=inbox --follow`
after `mcp-use client connect notes http://localhost:3000/mcp`.

## Try it with ChatGPT

```sh
pnpm dev:tunnel
```

Add the tunnel URL as a plugin in ChatGPT, then ask it to watch the inbox
folder. ChatGPT subscribes with its own HTTPS callback.

## Production storage

Set `MCP_USE_PLATFORM_STORAGE_URL` and `MCP_USE_PLATFORM_STORAGE_TOKEN` (Redis
over the Upstash REST protocol; Manufact Cloud injects them), or pass
`events: { store: upstashEventsStore({ url, token }) }` from `mcp-use/events`.

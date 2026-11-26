# MCP Events: notes server

`create_note` emits `note.created`, delivered by webhook to subscribers
(the ChatGPT MCP Events dialect). Nothing to configure in dev: subscriptions
are kept in memory and reset on restart.

```sh
pnpm dev
```

Open the Inspector's **Events** tab, subscribe to `note.created` with
`{ "folder": "inbox" }` (the callback is the Inspector's webhook inbox), then
call `create_note` with `{ "folder": "inbox", "title": "Hello" }`. The signed
delivery appears in the inbox; its `webhook-id` is the note id.

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

# MCP Events: notes server

A self-contained notes server. The `create_note` tool emits `note.created`, a
replayable event offered over webhook, push and poll. `clock.tick` is an
optional event with `replay: false`. No accounts, storage or environment
variables are needed in dev.

```sh
pnpm dev
```

Open the Inspector's **Events** tab, subscribe to `note.created` with
`{ "folder": "inbox" }`, then call `create_note` with
`{ "folder": "inbox", "title": "Hello" }`. The event lands in the local inbox.
Under `mcp-use dev` the Inspector subscribes as the dev principal `dev|local`.

## Try it with ChatGPT

```sh
pnpm dev:tunnel
```

Add the tunnel URL as a connector in ChatGPT Developer mode and enable
event-triggered scheduled tasks. A server with no OAuth accepts anonymous
`openai`-dialect webhook subscriptions (`anonymous: "auto"`). After a catalog
change, use **Refresh tools** in ChatGPT.

## Compatibility overrides

These variables are read only by this example, never by `mcp-use`. Each maps
1:1 onto public `events` configuration and drives the live-validation
checklist.

| Variable | Maps to | Example |
|---|---|---|
| `EXAMPLE_EVENTS_DIALECT` | `events.compatibility.dialect` | `openai@1` |
| `EXAMPLE_EVENTS_AXES` | `events.compatibility.axes` (JSON) | `{"webhookId":"random","replayCursors":true}` |
| `EXAMPLE_EVENTS_ADVERTISE` | a `compatibility.knownClients` row with `advertise` | `top` |
| `EXAMPLE_EVENTS_TTL_MS` | `events.ttl.default` | `3600000` |
| `EXAMPLE_EVENTS_ANONYMOUS` | `events.anonymous` | `reject` |
| `EXAMPLE_EVENTS_TICK_MS` | emits `clock.tick` at this interval | `5000` |

```sh
pnpm verify
```
